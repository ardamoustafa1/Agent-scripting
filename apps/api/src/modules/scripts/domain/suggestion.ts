import { fromPointer, toPointer } from '@verbis/script-schema';
import type { SuggestionOperation } from '@verbis/shared-types';

/**
 * Accept-time guards for a suggestion (ADR-0051). A suggestion is a patch made against a draft
 * that may keep changing; instead of storing the whole base document, every operation records
 * what it relied on, and the patch is applied only if all of it still holds. Anything else is
 * reported as stale, never auto-resolved.
 */
export type SuggestionGuard =
  | { kind: 'value'; path: string; value: unknown }
  | { kind: 'absent'; path: string }
  | { kind: 'length'; path: string; length: number };

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return value === undefined ? 'undefined' : JSON.stringify(value);
};

/** Value at a pointer, or `undefined` when any segment is missing. */
export function valueAt(document: unknown, pointer: string): unknown {
  let current: unknown = document;
  for (const segment of fromPointer(pointer)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current)
      ? /^(0|[1-9]\d*)$/.test(segment)
        ? current[Number(segment)]
        : undefined
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

const parentOf = (pointer: string): string => toPointer(fromPointer(pointer).slice(0, -1));

/** Records what every operation depends on in `document`. */
export function buildGuards(
  document: unknown,
  operations: readonly SuggestionOperation[],
): SuggestionGuard[] {
  return operations.map((operation): SuggestionGuard => {
    if (operation.op !== 'add')
      return { kind: 'value', path: operation.path, value: valueAt(document, operation.path) };
    const parent = valueAt(document, parentOf(operation.path));
    if (Array.isArray(parent))
      return { kind: 'length', path: parentOf(operation.path), length: parent.length };
    const existing = valueAt(document, operation.path);
    return existing === undefined
      ? { kind: 'absent', path: operation.path }
      : { kind: 'value', path: operation.path, value: existing };
  });
}

/** True when every guard still holds in `document`. */
export function guardsHold(document: unknown, guards: readonly SuggestionGuard[]): boolean {
  return guards.every((guard) => {
    const current = valueAt(document, guard.path);
    if (guard.kind === 'absent') return current === undefined;
    if (guard.kind === 'length') return Array.isArray(current) && current.length === guard.length;
    return current !== undefined && canonical(current) === canonical(guard.value);
  });
}
