/** Deterministic clock for tests (CLAUDE.md §8: inject clocks). */
export interface TestClock {
  now(): Date;
  advance(ms: number): void;
  set(date: Date | string): void;
}

export function fixedClock(start: Date | string = '2026-01-01T00:00:00.000Z'): TestClock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
    set: (date) => {
      current = new Date(date).getTime();
    },
  };
}
