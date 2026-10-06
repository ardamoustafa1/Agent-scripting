import { describe, expect, it } from 'vitest';

import { compileExpression, evaluate, tryEvaluate } from './index.js';

const options = { now: () => Date.parse('2026-10-03T12:00:00Z'), budgetClock: () => 0 };
describe('decision boundaries and isolation', () => {
  it.each([-1, 0, 1, 99, 100, 101])(
    'keeps inclusive and exclusive limits distinct at %i',
    (value) => {
      const facts = { vars: { value } };
      expect(evaluate('vars.value >= 0 && vars.value < 100', facts, options)).toBe(
        value >= 0 && value < 100,
      );
      expect(evaluate('vars.value > 0 && vars.value <= 100', facts, options)).toBe(
        value > 0 && value <= 100,
      );
    },
  );
  it.each([
    [false, false],
    [0, 0],
    ['', ''],
    [null, 'fallback'],
  ] as const)('coalescing only substitutes null (%j)', (value, expected) => {
    expect(evaluate('vars.value ?? "fallback"', { vars: { value } }, options)).toBe(expected);
  });
  it('compiled decisions do not retain values between tenants or mutate input', () => {
    const expression = compileExpression('vars.allowed && vars.amount >= 100', options);
    const first = Object.freeze({ vars: Object.freeze({ allowed: true, amount: 100 }) });
    expect(expression.evaluate(first)).toBe(true);
    expect(expression.evaluate({ vars: { allowed: false, amount: 100 } })).toBe(false);
    expect(expression.evaluate(first)).toBe(true);
    expect(first.vars.amount).toBe(100);
  });
  it.each(['vars.constructor', 'vars.__proto__', 'vars["prototype"]'])(
    'rejects prototype access: %s',
    (source) => {
      expect(tryEvaluate(source, { vars: {} }, options).ok).toBe(false);
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    },
  );
});
