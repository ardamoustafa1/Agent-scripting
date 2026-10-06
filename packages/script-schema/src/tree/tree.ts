import { castDraft, enablePatches, produceWithPatches, type Draft } from 'immer';

import { NodeIdSchema } from '../ids.js';
import { cloneJson } from '../json.js';
import { toPointer, type PathSegment } from '../pointer.js';

import { toJsonPatch, type JsonPatchOperation } from './json-patch.js';

import type { Action } from '../schema/actions.js';
import type { ScriptDocument } from '../schema/document.js';
import type { Node } from '../schema/node.js';

export type TreeErrorCode =
  | 'NODE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'INDEX_OUT_OF_RANGE'
  | 'ROOT_NODE_IMMUTABLE'
  | 'MOVE_INTO_DESCENDANT'
  | 'DUPLICATE_ID'
  | 'INVALID_ID';

export class TreeOperationError extends Error {
  override readonly name = 'TreeOperationError';

  constructor(
    readonly code: TreeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface NodeLocation {
  readonly node: Node;
  readonly pageIndex: number;
  readonly pageId: string;
  /** Path segments from the document root, e.g. `['pages', 0, 'layout', 'children', 1]`. */
  readonly path: readonly PathSegment[];
  /** JSON Pointer of `path`. */
  readonly pointer: string;
  /** Undefined for a page's root node. */
  readonly parent?: Node;
  readonly index?: number;
  readonly depth: number;
}

/** Result of an edit: the next immutable document plus forward and inverse JSON Patch. */
export interface EditResult {
  readonly document: ScriptDocument;
  readonly patches: readonly JsonPatchOperation[];
  readonly inversePatches: readonly JsonPatchOperation[];
}

/** Visits every node depth-first, pre-order. Return `false` from the visitor to stop. */
export function walkNodes(
  doc: ScriptDocument,
  visitor: (location: NodeLocation) => boolean | undefined,
): void {
  const visit = (
    node: Node,
    pageIndex: number,
    pageId: string,
    path: readonly PathSegment[],
    depth: number,
    parent?: Node,
    index?: number,
  ): boolean => {
    const location: NodeLocation = {
      node,
      pageIndex,
      pageId,
      path,
      pointer: toPointer(path),
      depth,
      ...(parent === undefined ? {} : { parent }),
      ...(index === undefined ? {} : { index }),
    };
    if (visitor(location) === false) return false;
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (
        child !== undefined &&
        !visit(child, pageIndex, pageId, [...path, 'children', i], depth + 1, node, i)
      )
        return false;
    }
    return true;
  };
  for (let p = 0; p < doc.pages.length; p += 1) {
    const page = doc.pages[p];
    if (page !== undefined && !visit(page.layout, p, page.id, ['pages', p, 'layout'], 1)) return;
  }
}

export function findNode(doc: ScriptDocument, id: string): NodeLocation | undefined {
  let found: NodeLocation | undefined;
  walkNodes(doc, (location) => {
    if (location.node.id !== id) return true;
    found = location;
    return false;
  });
  return found;
}

/** All node ids in `node`'s subtree, including itself. */
export function subtreeIds(node: Node): string[] {
  return [node.id, ...(node.children ?? []).flatMap(subtreeIds)];
}

function allNodeIds(doc: ScriptDocument): Set<string> {
  const ids = new Set<string>();
  walkNodes(doc, ({ node }) => {
    ids.add(node.id);
    return true;
  });
  return ids;
}

function locate(
  doc: ScriptDocument,
  id: string,
  code: TreeErrorCode = 'NODE_NOT_FOUND',
): NodeLocation {
  const location = findNode(doc, id);
  if (location === undefined) throw new TreeOperationError(code, `Node "${id}" not found`);
  return location;
}

/** Resolves a location's path inside an immer draft. */
function draftAt(draft: Draft<ScriptDocument>, path: readonly PathSegment[]): Draft<Node> {
  let current: unknown = draft;
  for (const segment of path) current = (current as Record<PathSegment, unknown>)[segment];
  return current as Draft<Node>;
}

function edit(doc: ScriptDocument, recipe: (draft: Draft<ScriptDocument>) => void): EditResult {
  enablePatches();
  const [document, patches, inverse] = produceWithPatches(doc, recipe);
  return { document, patches: toJsonPatch(patches), inversePatches: toJsonPatch(inverse) };
}

function checkIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new TreeOperationError('INDEX_OUT_OF_RANGE', `Index ${index} is outside 0..${length}`);
  }
}

export interface InsertTarget {
  readonly parentId: string;
  /** Position among the parent's children; defaults to appending. */
  readonly index?: number;
}

/** Inserts a new node (and its subtree). All ids in the subtree must be new. */
export function insertNode(doc: ScriptDocument, target: InsertTarget, node: Node): EditResult {
  const parent = locate(doc, target.parentId, 'PARENT_NOT_FOUND');
  const existing = allNodeIds(doc);
  const incoming = subtreeIds(node);
  for (const id of incoming) {
    if (!NodeIdSchema.safeParse(id).success)
      throw new TreeOperationError('INVALID_ID', `Invalid node id "${id}"`);
  }
  const clash = incoming.find((id, i) => existing.has(id) || incoming.indexOf(id) !== i);
  if (clash !== undefined)
    throw new TreeOperationError('DUPLICATE_ID', `Node id "${clash}" already exists`);
  const length = parent.node.children?.length ?? 0;
  const index = target.index ?? length;
  checkIndex(index, length);
  return edit(doc, (draft) => {
    const draftParent = draftAt(draft, parent.path);
    draftParent.children ??= [];
    draftParent.children.splice(index, 0, castDraft(cloneJson(node)));
  });
}

/**
 * Moves a node under `parentId` at `index`. When moving within the same parent, `index` is the
 * position after the node has been taken out.
 */
export function moveNode(doc: ScriptDocument, id: string, target: InsertTarget): EditResult {
  const source = locate(doc, id);
  if (source.parent === undefined || source.index === undefined) {
    throw new TreeOperationError('ROOT_NODE_IMMUTABLE', `Page root "${id}" cannot be moved`);
  }
  const parent = locate(doc, target.parentId, 'PARENT_NOT_FOUND');
  if (subtreeIds(source.node).includes(parent.node.id)) {
    throw new TreeOperationError(
      'MOVE_INTO_DESCENDANT',
      `Cannot move "${id}" into its own subtree`,
    );
  }
  const sameParent = parent.node.id === source.parent.id;
  const length = (parent.node.children?.length ?? 0) - (sameParent ? 1 : 0);
  const index = target.index ?? length;
  checkIndex(index, length);
  const sourceIndex = source.index;
  const sourceParentPath = source.path.slice(0, -2);

  return edit(doc, (draft) => {
    const from = draftAt(draft, sourceParentPath);
    const [moved] = from.children?.splice(sourceIndex, 1) ?? [];
    if (moved === undefined) return;
    // Resolve the destination after removal: paths through the old parent may have shifted.
    const location = findNode(draft, parent.node.id);
    if (location === undefined) return;
    const to = draftAt(draft, location.path);
    to.children ??= [];
    to.children.splice(index, 0, moved);
  });
}

/** Removes a node and its subtree. Page roots cannot be removed (remove the page instead). */
export function removeNode(doc: ScriptDocument, id: string): EditResult {
  const location = locate(doc, id);
  if (location.parent === undefined || location.index === undefined) {
    throw new TreeOperationError('ROOT_NODE_IMMUTABLE', `Page root "${id}" cannot be removed`);
  }
  const index = location.index;
  return edit(doc, (draft) => {
    draftAt(draft, location.path.slice(0, -2)).children?.splice(index, 1);
  });
}

/** Applies an immer recipe to one node. Changing the node's `id` or `children` is rejected. */
export function updateNode(
  doc: ScriptDocument,
  id: string,
  recipe: (node: Draft<Node>) => void,
): EditResult {
  const location = locate(doc, id);
  return edit(doc, (draft) => {
    const node = draftAt(draft, location.path);
    const children = node.children;
    recipe(node);
    if (node.id !== id)
      throw new TreeOperationError('INVALID_ID', 'updateNode cannot change a node id');
    if (node.children !== children) {
      throw new TreeOperationError(
        'INVALID_ID',
        'updateNode cannot replace children; use insert/move/remove',
      );
    }
  });
}

/** Default id strategy: `btn-ok` → `btn-ok-copy`, `btn-ok-copy-2`, … (deterministic). */
export function nextCopyId(id: string, taken: ReadonlySet<string>): string {
  const base = id.replace(/-copy(-\d+)?$/, '');
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? '-copy' : `-copy-${n}`;
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const NESTED_ACTION_FIELDS = [
  'onSuccess',
  'onError',
  'onInvalid',
  'then',
  'else',
  'actions',
] as const;

function remapActions(actions: Action[], ids: ReadonlyMap<string, string>): void {
  for (const action of actions) {
    if (action.type === 'maskField') action.node = ids.get(action.node) ?? action.node;
    for (const field of NESTED_ACTION_FIELDS) {
      const nested = (action as Partial<Record<(typeof NESTED_ACTION_FIELDS)[number], Action[]>>)[
        field
      ];
      if (nested !== undefined) remapActions(nested, ids);
    }
  }
}

function cloneWithIds(node: Node, ids: ReadonlyMap<string, string>): Node {
  const copy = cloneJson(node);
  const rename = (current: Node): void => {
    current.id = ids.get(current.id) ?? current.id;
    for (const list of Object.values(current.events)) remapActions(list, ids);
    current.children?.forEach(rename);
  };
  rename(copy);
  return copy;
}

export interface DuplicateOptions {
  /** Custom id strategy. Must return a kebab-case id not in `taken`. */
  readonly generateId?: (originalId: string, taken: ReadonlySet<string>) => string;
}

/**
 * Deep-copies a node right after itself, giving every node in the copy a fresh id. `maskField`
 * references inside the copy are re-pointed at the copied nodes.
 */
export function duplicateNode(
  doc: ScriptDocument,
  id: string,
  options: DuplicateOptions = {},
): EditResult & { readonly newId: string; readonly idMap: ReadonlyMap<string, string> } {
  const source = locate(doc, id);
  if (source.parent === undefined || source.index === undefined) {
    throw new TreeOperationError('ROOT_NODE_IMMUTABLE', `Page root "${id}" cannot be duplicated`);
  }
  const taken = allNodeIds(doc);
  const generate = options.generateId ?? nextCopyId;
  const idMap = new Map<string, string>();
  for (const original of subtreeIds(source.node)) {
    const next = generate(original, taken);
    if (!NodeIdSchema.safeParse(next).success)
      throw new TreeOperationError('INVALID_ID', `Invalid node id "${next}"`);
    if (taken.has(next))
      throw new TreeOperationError('DUPLICATE_ID', `Node id "${next}" already exists`);
    taken.add(next);
    idMap.set(original, next);
  }
  const copy = cloneWithIds(source.node, idMap);
  const result = insertNode(doc, { parentId: source.parent.id, index: source.index + 1 }, copy);
  return { ...result, newId: copy.id, idMap };
}
