import { enablePatches, produceWithPatches, type Draft } from 'immer';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import { createComponentRegistry } from '@verbis/components';
import { parseExpression as parse } from '@verbis/expr';
import { resources } from '@verbis/i18n';
import {
  migrate,
  NodeSchema,
  PageSchema,
  ScriptDocumentSchema,
  findNode,
  walkNodes,
  insertNode,
  moveNode,
  removeNode,
  duplicateNode,
  updateNode,
  applyJsonPatch,
  toJsonPatch,
  validateSemantics,
  type Node,
  type ScriptDocument,
  type EditResult,
  type Breakpoint,
} from '@verbis/script-schema';

import { insertBlock, type BlockId } from './blocks.js';

export const editorRegistry = createComponentRegistry();
export interface EditorState {
  document: ScriptDocument;
  selection: readonly string[];
  pageId: string;
  revision: number;
  history: number;
  future: number;
  breakpoint: Breakpoint;
  zoom: number;
  message: string | null;
  writeSuspended: boolean;
  /** D-09: inspector fields holding input the document model rejected (not part of the document). */
  fieldProblems: number;
}
export interface EditorIssue {
  severity: string;
  code: string;
  path: string;
  messageKey: string;
  params?: Record<string, string | number>;
}
interface HistoryEntry {
  patches: EditResult['patches'];
  inversePatches: EditResult['inversePatches'];
}
export class EditorStore {
  private fieldProblemKeys = new Set<string>();
  setFieldProblem(key: string, active: boolean) {
    if (this.fieldProblemKeys.has(key) === active) return;
    if (active) this.fieldProblemKeys.add(key);
    else this.fieldProblemKeys.delete(key);
    this.publish({ fieldProblems: this.fieldProblemKeys.size });
  }
  setWriteSuspended(writeSuspended: boolean) {
    this.publish({ writeSuspended });
  }
  private sharedHistory: { undo: () => void; redo: () => void } | undefined;
  attachSharedHistory(undo: () => void, redo: () => void) {
    this.sharedHistory = { undo, redo };
    return () => {
      this.sharedHistory = undefined;
    };
  }
  applyRemote(document: unknown) {
    const parsed = ScriptDocumentSchema.parse(document);
    editorRegistry.validate(parsed);
    this.past = [];
    this.next = [];
    this.publish({
      document: parsed,
      revision: this.state.revision + 1,
      selection: this.state.selection.filter((id) => !!findNode(parsed, id)),
      pageId: parsed.pages.some((p) => p.id === this.state.pageId)
        ? this.state.pageId
        : (parsed.pages[0]?.id ?? ''),
    });
  }
  private issueDocument: ScriptDocument | undefined;
  private issueCache: readonly EditorIssue[] = [];
  private listeners = new Set<() => void>();
  private past: HistoryEntry[] = [];
  private next: HistoryEntry[] = [];
  private clipboard: Node[] = [];
  private transaction: HistoryEntry | null = null;
  private state: EditorState;
  private locations = new Map<string, NonNullable<ReturnType<typeof findNode>>>();
  constructor(
    document: unknown,
    readonly readonlyPages: ReadonlySet<string> = new Set(),
    private idFactory = () => `node-${crypto.randomUUID()}`,
  ) {
    const parsed = ScriptDocumentSchema.parse(document);
    this.state = {
      document: parsed,
      selection: [],
      pageId: parsed.pages[0]?.id ?? '',
      revision: 0,
      history: 0,
      future: 0,
      breakpoint: 'base',
      zoom: 1,
      message: null,
      writeSuspended: false,
      fieldProblems: 0,
    };
    this.index();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private index() {
    this.locations.clear();
    walkNodes(this.state.document, (location) => {
      this.locations.set(location.node.id, location);
      return true;
    });
  }
  location(id: string) {
    return this.locations.get(id);
  }
  node(id: string) {
    return this.location(id)?.node;
  }
  private publish(update: Partial<EditorState>) {
    this.state = {
      ...this.state,
      ...update,
      ...(update.document &&
      !update.document.pages.some((page) => page.id === (update.pageId ?? this.state.pageId))
        ? { pageId: update.document.pages[0]?.id ?? '' }
        : {}),
      history: this.sharedHistory ? 1 : this.past.length,
      future: this.sharedHistory ? 1 : this.next.length,
    };
    if (update.document) this.index();
    if (!this.transaction) for (const listener of this.listeners) listener();
  }
  private writable(ids: readonly string[]) {
    if (
      ids.some((id) => {
        const l = this.location(id);
        return !l || this.readonlyPages.has(l.pageId);
      })
    )
      throw new Error('VERBIS_LINKED_READONLY');
  }
  canDrop(parentId: string, type: string, movingId?: string) {
    const parent = this.node(parentId);
    if (!parent || this.readonlyPages.has(this.location(parentId)?.pageId ?? '')) return false;
    if (!editorRegistry.canDrop(parent.type, type)) return false;
    if (movingId) {
      let current = this.location(parentId);
      while (current) {
        if (current.node.id === movingId) return false;
        current = current.parent ? this.location(current.parent.id) : undefined;
      }
      if (
        !this.location(movingId)?.parent ||
        this.readonlyPages.has(this.location(movingId)?.pageId ?? '')
      )
        return false;
    }
    return true;
  }
  commit(result: EditResult) {
    if (this.state.writeSuspended) throw new Error('VERBIS_COLLABORATION_NOT_READY');
    if (!result.patches.length) return;
    ScriptDocumentSchema.parse(result.document);
    editorRegistry.validate(result.document);
    if (this.transaction) {
      this.transaction = {
        patches: [...this.transaction.patches, ...result.patches],
        inversePatches: [...result.inversePatches, ...this.transaction.inversePatches],
      };
    } else this.past.push({ patches: result.patches, inversePatches: result.inversePatches });
    this.next = [];
    this.publish({ document: result.document, revision: this.state.revision + 1, message: null });
  }
  edit(recipe: (draft: Draft<ScriptDocument>) => void) {
    enablePatches();
    const [document, patches, inverse] = produceWithPatches(this.state.document, recipe);
    this.commit({ document, patches: toJsonPatch(patches), inversePatches: toJsonPatch(inverse) });
  }
  batch(work: () => void) {
    if (this.transaction) {
      work();
      return;
    }
    const before = this.state;
    const oldNext = this.next;
    this.transaction = { patches: [], inversePatches: [] };
    try {
      work();
      const entry = this.transaction;
      if (entry.patches.length) this.past.push(entry);
      this.transaction = null;
      this.publish({});
    } catch (error) {
      this.transaction = null;
      this.state = before;
      this.next = oldNext;
      this.index();
      this.publish({});
      throw error;
    }
  }
  execute(work: () => void) {
    try {
      work();
    } catch {
      this.publish({ message: 'designer.editor.operationFailed' });
    }
  }
  select(id: string, add = false) {
    if (!this.node(id)) return;
    this.publish({
      selection: add
        ? this.state.selection.includes(id)
          ? this.state.selection.filter((value) => value !== id)
          : [...this.state.selection, id]
        : [id],
    });
  }
  selectParent() {
    const id = this.state.selection.at(-1);
    const parent = id ? this.location(id)?.parent : undefined;
    this.publish({ selection: parent ? [parent.id] : [] });
  }
  setView(update: Partial<Pick<EditorState, 'pageId' | 'breakpoint' | 'zoom'>>) {
    this.publish({ ...update, ...(update.pageId ? { selection: [] } : {}) });
  }
  insert(type: string, parentId: string, index?: number) {
    this.writable([parentId]);
    if (!this.canDrop(parentId, type)) throw new Error('VERBIS_DROP_INVALID');
    const node = NodeSchema.parse({
      id: this.idFactory(),
      type,
      props: editorRegistry.get(type).defaults,
    });
    this.batch(() => {
      if (type === 'explicitConsent')
        this.edit((doc) => {
          for (const locale of ['tr', 'en'] as const) {
            doc.i18n.messages[locale] ??= {};
            doc.i18n.messages[locale]['components.consentLabel'] ??=
              resources[locale].translation.components.consentLabel;
          }
        });
      if (type === 'repeater') {
        const existing = this.state.document.variables.find(
          (variable) =>
            variable.key === 'items' &&
            variable.type === 'array' &&
            variable.classification !== 'pci',
        );
        let key = existing?.key ?? 'items';
        if (!existing) {
          let suffix = 1;
          while (this.state.document.variables.some((variable) => variable.key === key))
            key = `items${suffix++}`;
          this.edit((doc) => {
            doc.variables.push({
              key,
              type: 'array',
              scope: 'session',
              default: [],
              classification: 'internal',
              pii: false,
              persist: false,
            });
          });
        }
        node.props['arrayVariable'] = key;
      }
      this.commit(
        insertNode(
          this.state.document,
          { parentId, ...(index === undefined ? {} : { index }) },
          node,
        ),
      );
    });
    this.select(node.id);
  }
  move(id: string, parentId: string, index?: number) {
    this.writable([id, parentId]);
    const node = this.node(id);
    if (!node || !this.canDrop(parentId, node.type, id)) throw new Error('VERBIS_DROP_INVALID');
    this.commit(
      moveNode(this.state.document, id, { parentId, ...(index === undefined ? {} : { index }) }),
    );
  }
  update(id: string, recipe: (node: Draft<Node>) => void) {
    this.writable([id]);
    this.commit(updateNode(this.state.document, id, recipe));
  }
  roots() {
    const roots = this.state.selection.filter((id) => {
      let parent = this.location(id)?.parent;
      while (parent) {
        if (this.state.selection.includes(parent.id)) return false;
        parent = this.location(parent.id)?.parent;
      }
      return true;
    });
    const parentId = roots[0] ? this.location(roots[0])?.parent?.id : undefined;
    if (parentId && roots.every((id) => this.location(id)?.parent?.id === parentId))
      roots.sort(
        (left, right) => (this.location(left)?.index ?? 0) - (this.location(right)?.index ?? 0),
      );
    return roots;
  }
  remove() {
    const ids = this.roots();
    this.writable(ids);
    if (ids.some((id) => !this.location(id)?.parent)) throw new Error('VERBIS_ROOT_IMMUTABLE');
    this.batch(() => {
      for (const id of ids) this.commit(removeNode(this.state.document, id));
    });
    this.publish({ selection: [] });
  }
  copy() {
    this.clipboard = this.roots()
      .map((id) => this.node(id))
      .filter((node): node is Node => !!node);
    this.publish({});
  }
  canPaste(parentId: string | undefined) {
    return (
      !!parentId &&
      this.clipboard.length > 0 &&
      this.clipboard.every((node) => this.canDrop(parentId, node.type))
    );
  }
  paste(parentId: string) {
    this.writable([parentId]);
    if (!this.clipboard.length) return;
    const wrapperId = this.idFactory(),
      rootId = this.idFactory();
    const scratch = {
      ...this.state.document,
      pages: [
        PageSchema.parse({
          id: 'clipboard-page',
          name: 'Clipboard',
          layout: {
            id: rootId,
            type: 'box',
            children: [{ id: wrapperId, type: 'box', children: this.clipboard }],
          },
        }),
      ],
    };
    const result = duplicateNode(scratch, wrapperId, { generateId: () => this.idFactory() });
    const copies = findNode(result.document, result.newId)?.node.children ?? [];
    if (copies.some((node) => !this.canDrop(parentId, node.type)))
      throw new Error('VERBIS_DROP_INVALID');
    this.batch(() => {
      for (const node of copies) this.commit(insertNode(this.state.document, { parentId }, node));
    });
    this.publish({ selection: copies.map((node) => node.id) });
  }
  duplicate() {
    this.copy();
    const parent = this.roots().map((id) => this.location(id)?.parent?.id);
    if (!parent.length || parent.some((value) => value !== parent[0]) || !parent[0])
      throw new Error('VERBIS_SELECTION_PARENT');
    this.paste(parent[0]);
  }
  group() {
    const ids = this.roots();
    this.writable(ids);
    const first = ids[0] ? this.location(ids[0]) : undefined;
    if (!first?.parent || ids.some((id) => this.location(id)?.parent?.id !== first.parent?.id))
      throw new Error('VERBIS_SELECTION_PARENT');
    if (
      !this.canDrop(first.parent.id, 'box') ||
      ids.some((id) => !editorRegistry.canDrop('box', this.node(id)?.type ?? ''))
    )
      throw new Error('VERBIS_DROP_INVALID');
    const parentId = first.parent.id;
    const groupId = this.idFactory();
    this.batch(() => {
      this.commit(
        insertNode(
          this.state.document,
          { parentId: parentId, index: first.index ?? 0 },
          NodeSchema.parse({
            id: groupId,
            type: 'box',
            style: { base: { padding: 'md', gap: 'sm' } },
          }),
        ),
      );
      for (const id of ids) this.move(id, groupId);
    });
    this.select(groupId);
  }
  ungroup() {
    const roots = this.roots();
    if (roots.length !== 1) throw new Error('VERBIS_UNGROUP_INVALID');
    const id = roots[0],
      location = id ? this.location(id) : undefined;
    if (!location?.parent || location.node.type !== 'box')
      throw new Error('VERBIS_UNGROUP_INVALID');
    this.writable([location.node.id]);
    const parentId = location.parent.id;
    const children = [...(location.node.children ?? [])];
    if (children.some((child) => !this.canDrop(parentId, child.type, child.id)))
      throw new Error('VERBIS_DROP_INVALID');
    this.batch(() => {
      for (const [offset, child] of children.entries())
        this.move(child.id, parentId, (location.index ?? 0) + offset);
      this.commit(removeNode(this.state.document, location.node.id));
    });
    this.publish({ selection: children.map((child) => child.id) });
  }
  undo() {
    if (this.state.writeSuspended) return;
    if (this.sharedHistory) {
      this.sharedHistory.undo();
      return;
    }
    const entry = this.past.pop();
    if (!entry) return;
    this.next.push(entry);
    this.publish({
      document: applyJsonPatch(this.state.document, entry.inversePatches),
      revision: this.state.revision + 1,
      selection: [],
    });
    this.index();
  }
  redo() {
    if (this.state.writeSuspended) return;
    if (this.sharedHistory) {
      this.sharedHistory.redo();
      return;
    }
    const entry = this.next.pop();
    if (!entry) return;
    this.past.push(entry);
    this.publish({
      document: applyJsonPatch(this.state.document, entry.patches),
      revision: this.state.revision + 1,
      selection: [],
    });
    this.index();
  }
  addPage(name: string) {
    if (this.state.document.pages.every((page) => this.readonlyPages.has(page.id)))
      throw new Error('VERBIS_READONLY');
    const id = this.idFactory();
    this.edit((doc) => {
      doc.pages.push(PageSchema.parse({ id, name, layout: { id: this.idFactory(), type: 'box' } }));
      const node = { id: `flow-${id}`, type: 'page' as const, page: id };
      doc.flow.nodes.push(node);
      // D-13: splice into the first plain edge that reaches an end node: previous → new → end.
      const endIds = new Set(doc.flow.nodes.filter((n) => n.type === 'end').map((n) => n.id));
      const incoming = doc.flow.edges.find((e) => endIds.has(e.to) && !e.maxIterations);
      if (incoming) {
        doc.flow.edges.push({ id: `edge-${this.idFactory()}`, from: node.id, to: incoming.to });
        incoming.to = node.id;
      }
    });
    this.setView({ pageId: id });
  }
  /** Adds a verified building block as a new page, wired before the flow's end (A6). */
  addBlock(block: BlockId, name: string) {
    if (this.state.document.pages.every((page) => this.readonlyPages.has(page.id)))
      throw new Error('VERBIS_READONLY');
    let pageId = '';
    this.edit((doc) => {
      pageId = insertBlock(doc, block, name, this.idFactory);
    });
    this.setView({ pageId });
  }
  issues(): readonly EditorIssue[] {
    if (this.issueDocument === this.state.document) return this.issueCache;
    const issues: EditorIssue[] = validateSemantics(this.state.document);
    for (const location of this.locations.values()) {
      const definition = editorRegistry.get(location.node.type);
      const parsed = definition.propsSchema.safeParse({
        ...definition.defaults,
        ...location.node.props,
      });
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          issues.push({
            severity: 'error',
            code: 'VERBIS_COMPONENT_PROPS',
            path: location.pointer,
            messageKey: 'designer.editor.invalidProps',
            params: { property: issue.path.join('.') },
          });
      for (const binding of location.node.bindings)
        if ('expression' in binding) {
          try {
            parse(binding.expression);
          } catch {
            issues.push({
              severity: 'error',
              code: 'VERBIS_EXPRESSION',
              path: location.pointer,
              messageKey: 'designer.editor.invalidExpression',
            });
          }
        }
    }
    const scan = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === '$expr' && typeof child === 'string') {
          try {
            parse(child);
          } catch {
            issues.push({
              severity: 'error',
              code: 'VERBIS_EXPRESSION',
              path,
              messageKey: 'designer.editor.invalidExpression',
            });
          }
        } else scan(child, `${path}/${key}`);
      }
    };
    scan(this.state.document, '');
    this.issueDocument = this.state.document;
    this.issueCache = issues;
    return issues;
  }
}
export function useEditor(store: EditorStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export const EditorDocumentSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  version: z.number().int(),
  state: z.enum(['draft', 'in_review', 'approved', 'published', 'retired']),
  document: z.preprocess((value) => {
    try {
      return migrate(value).document;
    } catch {
      return value;
    }
  }, ScriptDocumentSchema),
  screens: z.array(
    z.object({
      sharedScreenId: z.uuid(),
      versionNumber: z.number().int(),
      mode: z.enum(['linked', 'detached']),
      pageIds: z.array(z.string()),
    }),
  ),
});
