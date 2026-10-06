import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPRESSION_LIMITS, resolveLimits } from './limits.js';

describe('resolveLimits', () => {
  it('returns defaults without overrides', () => {
    expect(resolveLimits()).toEqual(DEFAULT_EXPRESSION_LIMITS);
  });

  it('allows tightening limits', () => {
    expect(resolveLimits({ maxSteps: 100 }).maxSteps).toBe(100);
  });

  it('never exceeds platform ceilings', () => {
    expect(resolveLimits({ timeoutMs: 10_000 }).timeoutMs).toBe(
      DEFAULT_EXPRESSION_LIMITS.timeoutMs,
    );
  });

  it('ignores non-positive or non-finite values', () => {
    const limits = resolveLimits({
      maxAstDepth: 0,
      maxSteps: Number.POSITIVE_INFINITY,
      timeoutMs: -1,
    });
    expect(limits.maxAstDepth).toBe(DEFAULT_EXPRESSION_LIMITS.maxAstDepth);
    expect(limits.maxSteps).toBe(DEFAULT_EXPRESSION_LIMITS.maxSteps);
    expect(limits.timeoutMs).toBe(DEFAULT_EXPRESSION_LIMITS.timeoutMs);
  });

  it('returns frozen objects', () => {
    expect(Object.isFrozen(resolveLimits())).toBe(true);
  });
});
