import { toPointer } from './pointer.js';
import { applyJsonPatch, type JsonPatchOperation } from './tree/json-patch.js';

/**
 * Turns an edited document into suggestion operations against `base` (ADR-0051).
 *
 * Operations are independent of each other (distinct paths, never an array index that another
 * operation shifts). Objects are compared key by key. An array is compared element by element when
 * it has the same length and every element keeps its `id`/`key` at the same index, items appended
 * at the end become `add` operations, and any other array change (insert, remove, reorder), a
 * primitive or a type change is replaced as a whole. The owner reviews exactly what will change.
 */
export const MAX_SUGGESTION_OPERATIONS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return value === undefined ? 'undefined' : JSON.stringify(value);
};

export class TooManyOperationsError extends Error {
  override readonly name = 'TooManyOperationsError';
}

export function suggestOperations(base: unknown, edited: unknown): JsonPatchOperation[] {
  const operations: JsonPatchOperation[] = [];
  const push = (operation: JsonPatchOperation) => {
    if (operations.length >= MAX_SUGGESTION_OPERATIONS)
      throw new TooManyOperationsError(
        `More than ${String(MAX_SUGGESTION_OPERATIONS)} changes; split them into several suggestions`,
      );
    operations.push(operation);
  };
  const identity = (value: unknown): string | undefined => {
    if (!isRecord(value)) return undefined;
    const id = value['id'] ?? value['key'];
    return typeof id === 'string' ? id : undefined;
  };
  const walk = (path: readonly string[], before: unknown, after: unknown): void => {
    if (canonical(before) === canonical(after)) return;
    if (Array.isArray(before) && Array.isArray(after)) {
      const keep = before.length <= after.length ? before.length : -1;
      const sameShape =
        keep >= 0 &&
        before.every((item, index) => {
          const id = identity(item);
          return id !== undefined && id === identity(after[index]);
        });
      if (sameShape && after.length === before.length) {
        before.forEach((item, index) => {
          walk([...path, String(index)], item, after[index]);
        });
        return;
      }
      if (
        keep >= 0 &&
        after.length > before.length &&
        canonical(before) === canonical(after.slice(0, keep))
      ) {
        after.slice(keep).forEach((item, offset) => {
          push({ op: 'add', path: toPointer([...path, String(keep + offset)]), value: item });
        });
        return;
      }
    }
    if (isRecord(before) && isRecord(after)) {
      for (const key of Object.keys(before))
        if (!(key in after) || after[key] === undefined)
          push({ op: 'remove', path: toPointer([...path, key]) });
        else walk([...path, key], before[key], after[key]);
      for (const key of Object.keys(after))
        if (after[key] !== undefined && !(key in before))
          push({ op: 'add', path: toPointer([...path, key]), value: after[key] });
      return;
    }
    push({ op: 'replace', path: toPointer(path), value: after });
  };
  walk([], base, edited);
  return operations;
}

/** Convenience for callers and tests: the patch applied to `base`. */
export function applySuggestion<T extends object>(
  base: T,
  operations: readonly JsonPatchOperation[],
): T {
  return applyJsonPatch(base, operations);
}
