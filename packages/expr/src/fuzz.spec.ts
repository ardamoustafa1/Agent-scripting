import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { evaluate, exprToRule, parseExpression, ruleToExpr, tryEvaluate } from './index.js';

const options = { budgetClock: () => 0, now: () => 0 };
const config = { seed: 20261001, numRuns: 1000 };
describe('seeded property/fuzz conformance', () => {
  it('arbitrary input produces only a bounded AST or safe structured error', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2100 }), (source) => {
        const result = tryEvaluate(source, { vars: { x: 1 } }, options);
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) {
          expect(result.error.code).toMatch(/^[A-Z_]+$/);
          expect(Number.isFinite(result.error.position)).toBe(true);
        }
      }),
      config,
    );
  });
  it('arithmetic obeys declared precedence without executing generated JS', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (a, b, c) => {
          expect(evaluate(`(${a}) + (${b}) * (${c})`, {}, options)).toBe(a + b * c);
        },
      ),
      config,
    );
  });
  it('JSON literals round trip and are never interpreted as code', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 3 }), (value) => {
        const source = JSON.stringify(value);
        if (
          source.length > 2000 ||
          source.includes('constructor') ||
          source.includes('__proto__') ||
          source.includes('prototype')
        )
          return;
        const result = tryEvaluate(source, {}, options);
        if (result.ok) expect(JSON.stringify(result.value)).toBe(source);
      }),
      config,
    );
  });
  it('prototype escape paths always fail and cannot pollute host objects', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('__proto__', 'prototype', 'constructor'),
        fc.string({ maxLength: 32 }),
        (key, suffix) => {
          const source = `vars[${JSON.stringify(key)}][${JSON.stringify(suffix)}]`;
          expect(tryEvaluate(source, { vars: {} }, options).ok).toBe(false);
          expect(Object.prototype).not.toHaveProperty('polluted');
        },
      ),
      config,
    );
  });
  it('builder/string conversions preserve evaluation for synthetic facts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.constantFrom('eq', 'neq', 'gt', 'gte', 'lt', 'lte'),
        (actual, expected, op) => {
          const source = ruleToExpr({ fact: 'vars.x', op, value: expected });
          const context = { vars: { x: actual } };
          expect(evaluate(ruleToExpr(exprToRule(source)), context, options)).toBe(
            evaluate(source, context, options),
          );
          expect(parseExpression(source)).toHaveProperty('kind');
        },
      ),
      config,
    );
  });
  it('clock/timezone-independent execution is repeatable for identical inputs', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -100, max: 100 }), { maxLength: 20 }), (items) => {
        const source = 'sum(map(vars.items, x => x * 2))';
        const context = { vars: { items } };
        expect(evaluate(source, context, options)).toBe(evaluate(source, context, options));
      }),
      config,
    );
  });
});
