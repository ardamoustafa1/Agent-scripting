import { describe, expect, it } from 'vitest';

import { evaluate } from './interpreter.js';
import { evaluateRule, expressionToRule, ruleToExpression, type RuleOperator } from './rules.js';

import type { Value } from './types.js';

const options = { budgetClock: () => 0, now: () => 0 };
const numeric: [RuleOperator, number, boolean][] = [
  ['eq', -1, false],
  ['eq', 0, true],
  ['eq', 1, false],
  ['neq', -1, true],
  ['neq', 0, false],
  ['neq', 1, true],
  ['gt', -1, false],
  ['gt', 0, false],
  ['gt', 1, true],
  ['gte', -1, false],
  ['gte', 0, true],
  ['gte', 1, true],
  ['lt', -1, true],
  ['lt', 0, false],
  ['lt', 1, false],
  ['lte', -1, true],
  ['lte', 0, true],
  ['lte', 1, false],
];
const cases: [RuleOperator, Value, Value, boolean][] = [
  ...numeric.map(([op, fact, expected]): [RuleOperator, Value, Value, boolean] => [
    op,
    fact,
    0,
    expected,
  ]),
  ['in', 1, [1, 2], true],
  ['in', 3, [1, 2], false],
  ['notIn', 1, [1, 2], false],
  ['notIn', 3, [1, 2], true],
  ['contains', 'hello', 'ell', true],
  ['contains', 'hello', 'EL', false],
  ['contains', [0, false], false, true],
  ['contains', [0, false], 'false', false],
  ['startsWith', 'abc', 'ab', true],
  ['startsWith', 'abc', 'bc', false],
  ['matches', 'ABC', '^[A-Z]+$', true],
  ['matches', 'abc', '^[A-Z]+$', false],
  ['exists', null, null, false],
  ['exists', false, null, true],
  ['exists', '', null, true],
  ['exists', 0, null, true],
  ['between', -1, [0, 10], false],
  ['between', 0, [0, 10], true],
  ['between', 10, [0, 10], true],
  ['between', 11, [0, 10], false],
  ['before', '2026-10-01', '2026-10-02', true],
  ['before', '2026-10-02', '2026-10-02', false],
  ['before', '2026-10-03', '2026-10-02', false],
  ['after', '2026-10-01', '2026-10-02', false],
  ['after', '2026-10-02', '2026-10-02', false],
  ['after', '2026-10-03', '2026-10-02', true],
];
describe('rule builder execution parity', () => {
  it.each(cases)('%s keeps fact %j and value %j distinct', (op, fact, value, expected) => {
    const rule = { fact: 'vars.value', op, ...(op === 'exists' ? {} : { value }) };
    const expression = ruleToExpression(rule);
    const context = { vars: { value: fact } };
    expect(evaluateRule(rule, context, options)).toBe(expected);
    expect(evaluate(expression, context, options)).toBe(expected);
    const restored = expressionToRule(expression);
    expect(evaluateRule(restored, context, options)).toBe(expected);
    if (op !== 'notIn') expect(restored).toEqual(rule);
    else expect(restored).toEqual({ not: { fact: 'vars.value', op: 'in', value } });
  });
  it.each([false, true])('legacy AND and OR agree with predicate trees for %s', (value) => {
    const context = { vars: { value } };
    const yes = { fact: 'vars.value', op: 'eq', value: true };
    const no = { fact: 'vars.value', op: 'eq', value: false };
    expect(evaluateRule({ operator: 'AND', conditions: [yes, no] }, context, options)).toBe(false);
    expect(evaluateRule({ operator: 'OR', conditions: [yes, no] }, context, options)).toBe(true);
    expect(evaluateRule({ all: [yes, { not: no }] }, context, options)).toBe(value);
    expect(evaluateRule({ any: [no, { not: yes }] }, context, options)).toBe(!value);
  });
  it.each([
    'vars.value === -3',
    'vars.value === [1, -2, null, true]',
    'vars.value === {a: 1, b: [false]}',
  ])('preserves literal structure in %s', (expression) => {
    const restored = expressionToRule(expression);
    expect(restored).not.toHaveProperty('$expr');
    expect(expressionToRule(ruleToExpression(restored))).toEqual(restored);
  });
  it.each([
    'vars.value === other.value',
    'vars.value === [other.value]',
    'vars.value === {a: other.value}',
    'contains(vars.value)',
    'contains(vars.value, other.value)',
    'contains(vars.value, "x", "y")',
    'round(vars.value) > 2',
    '!round(vars.value)',
    'vars.value + 1',
  ])('preserves non-builder expressions losslessly: %s', (source) => {
    expect(expressionToRule(source)).toEqual({ $expr: source });
  });
});
