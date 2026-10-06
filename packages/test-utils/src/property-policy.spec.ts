import { expect, it } from 'vitest';

import { securityPropertyOptions } from './property-policy.js';

it('requires deterministic seeds and at least one thousand property cases', () => {
  expect(securityPropertyOptions(42)).toEqual({ seed: 42, numRuns: 1000 });
  expect(Object.isFrozen(securityPropertyOptions(42, 2000))).toBe(true);
  for (const runs of [0, 999, 1000.5, NaN, Infinity])
    expect(() => securityPropertyOptions(42, runs)).toThrow();
  expect(() => securityPropertyOptions(NaN)).toThrow();
});
