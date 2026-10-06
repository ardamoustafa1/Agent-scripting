import { describe, expect, it, vi } from 'vitest';

import {
  evaluate,
  parseExpression,
  renderTemplate,
  ruleToExpression,
  tryEvaluate,
} from './index.js';

const options = { budgetClock: () => 0 };
describe('sandbox attack corpus and budgets', () => {
  it.each([
    'eval("x")',
    'Function("x")',
    'new Function("x")',
    'with(x) {}',
    'globalThis.process',
    'process.env',
    'window.location',
    'import("x")',
    'vars.x = 1',
    'vars.x++',
    'vars.x; vars.y',
    '(()=>1)()',
    'vars.fn()',
    'vars["constructor"]',
    'vars.__proto__',
    'vars["proto" + "type"]',
    '{constructor: 1}',
    'parseJSON("{\\"__proto__\\":{}}")',
    'x => x',
    '1 "+" 2',
    '"unterminated',
    '"bad\\q"',
    '"bad\\uXY00"',
    '1 2',
    '[]()',
    '({x: 1, x: 2})',
    '{1:2}',
    'vars.["x"]',
  ])('rejects %s without host execution', (source) => {
    expect(tryEvaluate(source, { vars: {} }, options).ok).toBe(false);
  });
  it('rejects getters without invoking them and forbids host functions/prototypes', () => {
    const getter = vi.fn(() => 'leak');
    const object = Object.defineProperty({}, 'x', { get: getter });
    expect(tryEvaluate('vars.x', { vars: object }, options).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(tryEvaluate('vars', { vars: () => null }, options).ok).toBe(false);
    expect(tryEvaluate('vars', { vars: new Date(0) }, options).ok).toBe(false);
    expect(
      tryEvaluate('vars', { vars: Object.create({ inherited: 1 }) as unknown }, options).ok,
    ).toBe(false);
  });
  it('does not mutate caller state or global prototypes', () => {
    const facts = { vars: { x: 1 } };
    tryEvaluate('vars["__proto__"].polluted', facts, options);
    expect(facts).toEqual({ vars: { x: 1 } });
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('enforces source, parse depth, steps, string, collection, output and elapsed-time limits', () => {
    expect(() => parseExpression('1'.repeat(2001))).toThrow('SOURCE_LIMIT');
    expect(() => parseExpression('('.repeat(40) + '1' + ')'.repeat(40))).toThrow('DEPTH_LIMIT');
    expect(() => parseExpression(Array(50).fill('1').join('+'))).toThrow('DEPTH_LIMIT');
    expect(() => evaluate('1 + 2', {}, { limits: { maxSteps: 2 }, ...options })).toThrow(
      'STEP_LIMIT',
    );
    expect(() => evaluate('"abcdef"', {}, { limits: { maxStringLength: 3 }, ...options })).toThrow(
      'STRING_INVALID',
    );
    expect(() => evaluate('[1,2]', {}, { limits: { maxCollectionLength: 1 }, ...options })).toThrow(
      'COLLECTION_LIMIT',
    );
    expect(() => evaluate('"abc"', {}, { limits: { maxOutputBytes: 2 }, ...options })).toThrow(
      'OUTPUT_LIMIT',
    );
    let clock = 0;
    expect(() => evaluate('1', {}, { budgetClock: () => clock++ * 100 })).toThrow('TIMEOUT');
    expect(() =>
      evaluate(
        'map(vars.items, x => x + 1)',
        { vars: { items: Array(100).fill(1) } },
        { ...options, limits: { maxSteps: 150 } },
      ),
    ).toThrow('STEP_LIMIT');
    expect(() => renderTemplate(Array(33).fill('{{1}}').join(''), {}, options)).toThrow(
      'TEMPLATE_INVALID',
    );
  });
  it('handles classic ReDoS patterns in the RE2 engine and rejects backreferences', () => {
    expect(
      evaluate(
        'regexTest(vars.text, "(a+)+$")',
        { vars: { text: 'a'.repeat(1000) + '!' } },
        options,
      ),
    ).toBe(false);
    expect(tryEvaluate('regexTest("aa", "(a)\\\\1")', {}, options)).toMatchObject({
      ok: false,
      error: { code: 'REGEX_INVALID' },
    });
  });
  it('rejects malformed and oversized rule trees before recursive schema evaluation', () => {
    expect(() => ruleToExpression({ all: [] })).toThrow();
    expect(() => ruleToExpression({ fact: 'vars.constructor', op: 'eq', value: 1 })).toThrow();
    let rule: unknown = { fact: 'vars.x', op: 'eq', value: 1 };
    for (let i = 0; i < 40; i++) rule = { not: rule };
    expect(() => ruleToExpression(rule)).toThrow('DEPTH_LIMIT');
  });
});
