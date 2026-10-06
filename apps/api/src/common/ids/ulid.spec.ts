import { describe, expect, it } from 'vitest';

import { createUlidFactory, ULID_PATTERN, ulidTime } from './ulid.js';

const zeros = (n: number) => new Uint8Array(n);
const ones = (n: number) => new Uint8Array(n).fill(0xff);

describe('ULID', () => {
  it('encodes time and 80 random bits in Crockford base32', () => {
    const id = createUlidFactory(() => 1_469_918_176_385, zeros)();
    expect(id).toBe('01ARYZ6S410000000000000000');
    expect(ULID_PATTERN.test(id)).toBe(true);
    expect(ulidTime(id)).toBe(1_469_918_176_385);
  });

  it('is strictly monotonic within one millisecond', () => {
    const next = createUlidFactory(() => 1000, zeros);
    const ids = Array.from({ length: 1000 }, () => next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(1000);
  });

  it('stays monotonic when the clock steps back', () => {
    let now = 5000;
    const next = createUlidFactory(() => now, zeros);
    const a = next();
    now = 4000;
    const b = next();
    expect(b > a).toBe(true);
    expect(ulidTime(b)).toBe(5000);
  });

  it('throws on random overflow and invalid time', () => {
    const next = createUlidFactory(() => 1, ones);
    next();
    expect(() => next()).toThrow(/overflow/);
    expect(() => createUlidFactory(() => -1)()).toThrow(RangeError);
    expect(() => ulidTime('nope')).toThrow();
  });
});
