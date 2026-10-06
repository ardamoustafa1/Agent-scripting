/** Deterministic, UUID-shaped id generator for tests (CLAUDE.md §8). */
export function sequentialIds(prefix = '00000000-0000-7000-8000-'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${n.toString(16).padStart(12, '0')}`;
  };
}
