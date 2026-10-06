import { produce, type Draft, type Patch } from 'immer';

import { cloneJson } from '../json.js';
import { fromPointer, toPointer } from '../pointer.js';

/** RFC 6902 operations produced and consumed by the tree helpers. */
export type JsonPatchOperation =
  | { readonly op: 'add'; readonly path: string; readonly value: unknown }
  | { readonly op: 'replace'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string };

export class JsonPatchError extends Error {
  override readonly name = 'JsonPatchError';

  constructor(
    message: string,
    readonly operation: JsonPatchOperation,
  ) {
    super(message);
  }
}

/** Converts immer patches to RFC 6902 operations. */
export function toJsonPatch(patches: readonly Patch[]): JsonPatchOperation[] {
  return patches.map((patch) => {
    const path = toPointer(patch.path);
    return patch.op === 'remove'
      ? { op: 'remove', path }
      : { op: patch.op, path, value: patch.value as unknown };
  });
}

type Container = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Container =>
  typeof value === 'object' && value !== null;

function arrayIndex(
  segment: string,
  length: number,
  allowEnd: boolean,
  operation: JsonPatchOperation,
): number {
  if (allowEnd && segment === '-') return length;
  if (!/^(0|[1-9]\d*)$/.test(segment))
    throw new JsonPatchError(`Invalid array index "${segment}"`, operation);
  const index = Number(segment);
  if (index > length || (!allowEnd && index === length)) {
    throw new JsonPatchError(`Array index ${index} out of range`, operation);
  }
  return index;
}

function applyOne(root: Container, operation: JsonPatchOperation): void {
  const segments = fromPointer(operation.path);
  const last = segments.pop();
  if (last === undefined)
    throw new JsonPatchError('Replacing the document root is not supported', operation);
  let parent: unknown = root;
  for (const segment of segments) {
    if (!isContainer(parent))
      throw new JsonPatchError(`Path not found: ${operation.path}`, operation);
    parent = Array.isArray(parent)
      ? parent[arrayIndex(segment, parent.length, false, operation)]
      : parent[segment];
  }
  if (!isContainer(parent))
    throw new JsonPatchError(`Path not found: ${operation.path}`, operation);

  if (Array.isArray(parent)) {
    const index = arrayIndex(last, parent.length, operation.op === 'add', operation);
    if (operation.op === 'add') parent.splice(index, 0, cloneJson(operation.value));
    else if (operation.op === 'remove') parent.splice(index, 1);
    else parent[index] = cloneJson(operation.value);
    return;
  }
  if (operation.op !== 'add' && !Object.hasOwn(parent, last)) {
    throw new JsonPatchError(`Path not found: ${operation.path}`, operation);
  }
  if (operation.op === 'remove') {
    // Keys come from our own patch stream and target plain draft objects.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete parent[last];
  } else parent[last] = cloneJson(operation.value);
}

/**
 * Applies RFC 6902 `add` / `remove` / `replace` operations immutably (structural sharing via
 * immer). Use with `inversePatches` for undo and `patches` for redo.
 */
export function applyJsonPatch<T extends object>(
  document: T,
  operations: readonly JsonPatchOperation[],
): T {
  return produce(document, (draft: Draft<T>) => {
    for (const operation of operations) applyOne(draft as Container, operation);
  });
}
