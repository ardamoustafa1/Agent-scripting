import { describe, expect, it } from 'vitest';

import {
  analyzeExpression,
  evaluate,
  evaluateRule,
  exprToRule,
  isIBAN,
  isPhoneTR,
  isTCKN,
  isVKN,
  luhn,
  regexTest,
  renderTemplate,
  ruleToExpr,
  tryEvaluate,
  type ContextShape,
} from './index.js';

const options = { budgetClock: () => 0, now: () => 0 };
describe('edge cases and designer branch coverage', () => {
  const schema: ContextShape = {
    vars: {
      type: 'object',
      properties: {
        n: { type: 'number' },
        s: { type: 'string' },
        flag: { type: 'boolean' },
        empty: { type: 'null' },
      },
    },
    list: { type: 'array', items: { type: 'number' } },
  };
  it.each([
    ['true', 'boolean'],
    ['null', 'null'],
    ['"text"', 'string'],
    ['[1,2]', 'array'],
    ['[1,"x"]', 'array'],
    ['[]', 'array'],
    ['{x:vars.n}', 'object'],
    ['!vars.flag', 'boolean'],
    ['-vars.n', 'number'],
    ['vars.flag ? 1 : 2', 'number'],
    ['vars.flag ? 1 : "x"', 'unknown'],
    ['null ?? vars.n', 'number'],
    ['vars.n ?? 3', 'number'],
    ['vars.n in list', 'boolean'],
    ['vars.s + vars.s', 'string'],
    ['vars.flag && true', 'boolean'],
    ['vars.flag || false', 'boolean'],
    ['vars.n === 3', 'boolean'],
    ['vars.s.length', 'number'],
    ['list[0]', 'number'],
    ['filter(list, x => x > 0)', 'array'],
    ['find(list, x => x > 0)', 'number'],
    ['sum(list, x => x)', 'number'],
    ['map(list, x => x * 2)', 'array'],
    ['if(true, vars.n, 3)', 'number'],
  ] as const)('infers %s as %s', (source, type) => {
    expect(analyzeExpression(source, schema).type).toBe(type);
  });
  it.each([
    'vars.missing',
    'vars[true]',
    'unknown(1)',
    'round()',
    'vars.n < vars.s',
    'sum(list, x => "text")',
    'filter(list, x => 1)',
    'vars.n && true',
    'vars.s - 1',
    'true ? 1 : null',
  ])('reports or safely analyzes %s', (source) => {
    expect(analyzeExpression(source, schema)).toHaveProperty('diagnostics');
  });
  it('keeps missing optional fields null, rejects inherited names and invalid context values', () => {
    expect(evaluate('vars.missing', { vars: {} }, options)).toBeNull();
    expect(evaluate('vars["toString"]', { vars: {} }, options)).toBeNull();
    expect(evaluate('"abc"[9]', {}, options)).toBeNull();
    expect(evaluate('[1].foo', {}, options)).toBeNull();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Symbol('x'), BigInt(1)])
      expect(tryEvaluate('vars', { vars: value }, options).ok).toBe(false);
    expect(tryEvaluate('vars', { vars: Array(2) }, options).ok).toBe(false);
  });
  it('preserves escaped strings, string/object comparisons and collections with shadowing', () => {
    const escaped = '\t\b\f\r/\\"';
    expect(evaluate(JSON.stringify(escaped), {}, options)).toBe(escaped);
    expect(evaluate('{a:1} === {a:2}', {}, options)).toBe(false);
    expect(evaluate('[1] === {a:1}', {}, options)).toBe(false);
    expect(evaluate('"a" <= "b" && "b" >= "a"', {}, options)).toBe(true);
    expect(evaluate('map([1,2], x => sum(map([3,4], x => x)))', {}, options)).toEqual([7, 7]);
    expect(evaluate('filter([1,2], x => false)', {}, options)).toEqual([]);
    expect(evaluate('any([1], x => false)', {}, options)).toBe(false);
    expect(evaluate('all([1], x => true)', {}, options)).toBe(true);
    expect(evaluate('if(false, 1 / 0, 2)', {}, options)).toBe(2);
    expect(evaluate('switch(3, 1, 2, 9)', {}, options)).toBe(9);
  });
  it('uses fixed currency rules, numeric syntax and date-only UTC arithmetic', () => {
    expect(evaluate('formatCurrency(1)', {}, options)).toBe('1,00 ₺');
    expect(evaluate('formatCurrency(1, "en", "XYZ")', {}, options)).toBe('XYZ1.00');
    expect(evaluate('round(1234, -2)', {}, options)).toBe(1200);
    expect(evaluate('toNumber("-1.25e2")', {}, options)).toBe(-125);
    expect(evaluate('format("{0}-{9}", null)', {}, options)).toBe('-');
    expect(evaluate('mask("12")', {}, options)).toBe('12');
    expect(evaluate('age("0000-01-01")', {}, options)).toBe(1970);
    expect(tryEvaluate('addDays("2026-01-01", 1e20)', {}, options).ok).toBe(false);
    expect(tryEvaluate('now()', {}, { ...options, now: () => Number.NaN }).ok).toBe(false);
  });
  it('validates a synthetic IBAN and rejects malformed checksums/identifiers', () => {
    const bban = '0'.repeat(21) + '1';
    const rearranged = bban + '292700';
    let remainder = 0;
    for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
    const iban = `TR${String(98 - remainder).padStart(2, '0')}${bban}`;
    expect(isIBAN(iban)).toBe(true);
    expect(isIBAN(iban.toLowerCase())).toBe(true);
    expect(isIBAN(`TR00${bban}`)).toBe(false);
    expect(isIBAN(`ZZ00${bban}`)).toBe(false);
    expect(isTCKN('00000000000')).toBe(false);
    expect(isTCKN('10000000156')).toBe(false);
    expect(isVKN('short')).toBe(false);
    expect(isVKN('1111111115')).toBe(false);
    expect(luhn('0')).toBe(false);
    expect(luhn('0000')).toBe(false);
    expect(luhn('abc')).toBe(false);
    expect(isPhoneTR('+90 (500) 000-0000')).toBe(true);
    expect(regexTest('x\ny', '^y$', 'm')).toBe(true);
    expect(regexTest('x\ny', 'x.y', 's')).toBe(true);
    expect(() => regexTest('x', 'a'.repeat(257))).toThrow('REGEX_LIMIT');
    expect(() => regexTest('x', 'x', 'ii')).toThrow('REGEX_LIMIT');
  });
  it.each([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'notIn',
    'contains',
    'startsWith',
    'matches',
    'exists',
    'between',
    'before',
    'after',
  ])('round trips the %s builder leaf', (op) => {
    const value = ['in', 'notIn', 'between'].includes(op)
      ? [1, 3]
      : ['contains', 'startsWith', 'matches'].includes(op)
        ? 'a'
        : ['before', 'after'].includes(op)
          ? '2026-01-01'
          : -1;
    const expression = ruleToExpr({ fact: 'vars.x', op, value });
    expect(ruleToExpr(exprToRule(expression))).toBeTypeOf('string');
  });
  it('evaluates OR groups and expression leaves and escapes all HTML delimiter classes', () => {
    expect(
      evaluateRule(
        {
          operator: 'OR',
          conditions: [{ fact: 'vars.x', op: 'eq', value: 1 }, { $expr: 'vars.x === 2' }],
        },
        { vars: { x: 2 } },
        options,
      ),
    ).toBe(true);
    expect(renderTemplate('<>&"\'{{vars.x}}', { vars: { x: '&' } }, options)).toBe(
      '&lt;&gt;&amp;&quot;&#39;&amp;',
    );
    expect(renderTemplate('', {}, options)).toBe('');
    expect(renderTemplate('plain', {}, options)).toBe('plain');
  });
});
