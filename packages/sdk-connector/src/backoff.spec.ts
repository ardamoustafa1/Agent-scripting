import { describe, expect, it } from 'vitest';

import { backoffDelay } from './backoff.js';

describe('backoffDelay', () => {
  it('grows exponentially, is capped and jittered', () => {
    const top = () => 0.999_999;
    expect(backoffDelay(0, { random: top })).toBe(499);
    expect(backoffDelay(3, { random: top })).toBe(3_999);
    expect(backoffDelay(50, { random: top })).toBe(59_999);
    expect(backoffDelay(5, { random: () => 0 })).toBe(0);
    expect(backoffDelay(-1, { random: top, baseMs: 100 })).toBe(99);
  });
});
