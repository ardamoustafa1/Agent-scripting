import { useSyncExternalStore } from 'react';

/**
 * Node ids the owner is currently looking at through a suggestion (ADR-0051). A tiny external
 * store so the review panel and the canvas stay decoupled: the panel writes, `Frame` reads.
 */
const EMPTY: ReadonlySet<string> = new Set();
let marks: ReadonlySet<string> = EMPTY;
const listeners = new Set<() => void>();
export function setSuggestionMarks(ids: Iterable<string>): void {
  const next = new Set(ids);
  const same = next.size === marks.size && [...next].every((id) => marks.has(id));
  if (same) return;
  marks = next.size === 0 ? EMPTY : next;
  listeners.forEach((listener) => {
    listener();
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useSuggestionMark(nodeId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => marks.has(nodeId),
    () => false,
  );
}
