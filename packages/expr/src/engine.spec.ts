import { describe, expect, it, vi } from 'vitest';

import {
  analyzeExpression,
  completions,
  compileExpression,
  createDefaultRegistry,
  evaluate,
  exprToRule,
  extractDependencies,
  FunctionRegistry,
  renderTemplate,
  ruleToExpr,
  tryEvaluate,
  type ContextShape,
} from './index.js';

const options = { now: () => Date.parse('2026-10-01T12:00:00Z'), budgetClock: () => 0 };
const facts = {
  session: { customer: { name: 'Fixture' } },
  vars: { x: 3 },
  interaction: { ani: 'masked' },
  items: [{ amount: 50 }, { amount: 150 }],
};
describe('Pratt parser and sandbox interpreter', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['2 ** 3 ** 2', 512],
    ['-3 + +2', -1],
    ['10 / 2 + 10 % 3', 6],
    ['1 < 2 && 2 <= 2 && 3 > 2 && 3 >= 3', true],
    ['1 == 1 && 1 === 1 && 1 != 2 && 1 !== 2', true],
    ['1 == "1"', false],
    ['false || true', true],
    ['!false', true],
    ['false ? 1 : true ? 2 : 3', 2],
    ['null ?? 5', 5],
    ['0 ?? 5', 0],
    ['[1, 2, 3][1]', 2],
    ['{x: 1, "y": [2]}.y[0]', 2],
    ['"abc".length', 3],
    ['"abc"[1]', 'b'],
    ['[1, 2].length', 2],
    ['[1, 2] === [1, 2]', true],
    ['{a: 1, b: 2} === {b: 2, a: 1}', true],
    ['2 in [1, 2]', true],
    ['"a" + "b"', 'ab'],
    ["'a\\n\\u0042'", 'a\nB'],
    ['1.5e2', 150],
    ['.5 * 2', 1],
    ['[1,2,][0]', 1],
    ['{a: 1,}.a', 1],
    ['session.customer.name', 'Fixture'],
    ['vars.x', 3],
    ['interaction.ani', 'masked'],
    ['session.missing?.name ?? "fallback"', 'fallback'],
    ['null?.[1 / 0] ?? 4', 4],
  ] as const)('%s → %j', (source, expected) => {
    expect(evaluate(source, facts, options)).toEqual(expected);
  });
  it.each([
    'false && (1 / 0)',
    'true || (1 / 0)',
    'if(true, 1, 1 / 0)',
    'switch(2, 1, 1 / 0, 2, 7, 1 / 0)',
    'true ? 1 : missing',
  ])('short-circuits %s', (source) => {
    expect(() => evaluate(source, facts, options)).not.toThrow();
  });
  it.each([
    ['1 / 0', 'DIVISION_BY_ZERO'],
    ['1 % 0', 'DIVISION_BY_ZERO'],
    ['missing', 'UNKNOWN_IDENTIFIER'],
    ['null.name', 'NULL_ACCESS'],
    ['(2).name', 'TYPE_OBJECT'],
    ['"a" - 1', 'TYPE_NUMBER'],
    ['1 + "2"', 'TYPE_NUMBER'],
    ['1 < "2"', 'TYPE_COMPARISON'],
    ['null + 1', 'TYPE_NUMBER'],
    ['round()', 'ARGUMENT_COUNT'],
    ['bad()', 'UNKNOWN_FUNCTION'],
    ['map([1], 1)', 'LAMBDA_REQUIRED'],
    ['upper(x => x)', 'LAMBDA_NOT_ALLOWED'],
    ['x => x', 'LAMBDA_NOT_ALLOWED'],
    ['1e999', 'NUMBER_INVALID'],
    ['2 ** 1024', 'NUMBER_INVALID'],
  ] as const)('returns a safe error for %s', (source, code) => {
    expect(tryEvaluate(source, facts, options)).toMatchObject({ ok: false, error: { code } });
  });
  it('compiles once and evaluates against fresh immutable context snapshots', () => {
    const compiled = compileExpression('vars.x + 1', options);
    expect(compiled.evaluate({ vars: { x: 1 } })).toBe(2);
    expect(compiled.evaluate({ vars: { x: 4 } })).toBe(5);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(facts.vars.x).toBe(3);
    const result = evaluate('{a: [1]}', {}, options);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('permits only registry functions and trusted registry extensions', () => {
    const registry = createDefaultRegistry().register({
      name: 'double',
      parameters: ['number'],
      returns: 'number',
      minArgs: 1,
      maxArgs: 1,
      implementation: (args) => (typeof args[0] === 'number' ? args[0] * 2 : null),
    });
    expect(evaluate('double(3)', {}, { ...options, registry })).toBe(6);
    expect(() => registry.register(registry.get('double'))).toThrow(
      'FUNCTION_REGISTRATION_INVALID',
    );
    expect(() =>
      new FunctionRegistry().register({
        name: 'constructor',
        parameters: [],
        returns: 'null',
        minArgs: 0,
        maxArgs: 0,
        implementation: () => null,
      }),
    ).toThrow('FORBIDDEN_PROPERTY');
  });
});
describe('built-in registry conformance', () => {
  it.each([
    ['upper("abc")', 'ABC'],
    ['lower("ABC")', 'abc'],
    ['trim(" a ")', 'a'],
    ['contains("abc", "b")', true],
    ['contains([1,2],2)', true],
    ['startsWith("abc", "a")', true],
    ['format("Hi {0}: {1}", "Fixture", 3)', 'Hi Fixture: 3'],
    ['mask("123456", 2)', '****56'],
    ['mask("123", 0, "#")', '###'],
    ['padStart("3", 3, "0")', '003'],
    ['padStart("x", 2)', ' x'],
    ['round(1.234, 2)', 1.23],
    ['round(1.6)', 2],
    ['formatCurrency(1234.5, "tr", "TRY")', '1.234,50 ₺'],
    ['formatCurrency(-1234.5, "en", "USD")', '-$1,234.50'],
    ['now()', '2026-10-01T12:00:00.000Z'],
    ['addDays("2026-09-30", 1)', '2026-10-01T00:00:00.000Z'],
    ['diff("2026-10-02", "2026-10-01")', 1],
    ['diff("2026-10-01T01:00:00Z", "2026-10-01", "hours")', 1],
    ['formatDate("2026-10-01T12:03:04Z", "dd.MM.yyyy HH:mm:ss")', '01.10.2026 12:03:04'],
    ['formatDate("2026-10-01")', '2026-10-01'],
    ['isBusinessDay("2026-10-01")', true],
    ['isBusinessDay("2026-10-03")', false],
    ['isBusinessDay("2026-10-01", ["2026-10-01"])', false],
    ['age("2000-10-02")', 25],
    ['age("2000-10-01", "2026-10-01")', 26],
    ['count([1,2])', 2],
    ['sum([1,2,3])', 6],
    ['sum(items, x => x.amount)', 200],
    ['map(items, x => x.amount)', [50, 150]],
    ['filter(items, x => x.amount > 100)', [{ amount: 150 }]],
    ['find(items, x => x.amount > 100).amount', 150],
    ['find([], x => true)', null],
    ['any(items, x => x.amount > 100)', true],
    ['all(items, x => x.amount > 100)', false],
    ['all([], x => false)', true],
    ['any([], x => true)', false],
    ['isEmail("fixture@example.test")', true],
    ['isEmail("wrong")', false],
    ['isPhoneTR("05000000000")', true],
    ['isPhoneTR("123")', false],
    ['isTCKN("10000000146")', true],
    ['isTCKN("10000000147")', false],
    ['isVKN("1111111114")', true],
    ['isVKN("0000000000")', false],
    ['isIBAN("TR000")', false],
    ['luhn("79927398713")', true],
    ['luhn("79927398714")', false],
    ['regexTest("ABC", "^abc$", "i")', true],
    ['toNumber("12.5")', 12.5],
    ['toNumber(3)', 3],
    ['toString([1,2])', '[1,2]'],
    ['toString(null)', ''],
    ['parseJSON("{\\"x\\":1}").x', 1],
    ['exists(null)', false],
    ['exists(false)', true],
    ['between(3, [1,4])', true],
    ['before("2026-10-01", "2026-10-02")', true],
    ['after("2026-10-02", "2026-10-01")', true],
  ] as const)('%s → %j', (source, expected) => {
    expect(evaluate(source, facts, options)).toEqual(expected);
  });
  it.each([
    'round(1, 100)',
    'mask("x", -1)',
    'mask("x", 1, "##")',
    'padStart("x", 9999999)',
    'formatCurrency(1, "de")',
    'formatCurrency(1, "tr", "invalid")',
    'formatCurrency(1e16)',
    'addDays("2026-02-30", 1)',
    'diff("2026-01-01", "2026-01-01", "weeks")',
    'age("2030-01-01")',
    'formatDate("2026-01-01T01:00:00")',
    'toNumber(" ")',
    'toNumber(true)',
    'parseJSON("bad")',
    'regexTest("x", "(")',
    'regexTest("x", "x", "g")',
    'switch(1,1,2)',
    'between(1, [1])',
  ])('rejects invalid arguments %s', (source) => {
    expect(tryEvaluate(source, facts, options).ok).toBe(false);
  });
  it('uses a deterministic epoch default and captures the injected clock once', () => {
    expect(evaluate('now()')).toBe('1970-01-01T00:00:00.000Z');
    const now = vi.fn(() => 0);
    expect(evaluate('now() === now()', {}, { ...options, now })).toBe(true);
    expect(now).toHaveBeenCalledTimes(1);
  });
});
describe('designer analysis, templates and builder round trips', () => {
  const schema: ContextShape = {
    vars: { type: 'object', properties: { x: { type: 'number' }, name: { type: 'string' } } },
    items: { type: 'array', items: { type: 'object', properties: { amount: { type: 'number' } } } },
  };
  it('extracts complete dependency paths and excludes lambda locals', () => {
    expect(extractDependencies('session.customer.name + vars.x')).toEqual([
      'session.customer.name',
      'vars.x',
    ]);
    expect(extractDependencies('map(items, x => x.amount + vars.x)')).toEqual(['items', 'vars.x']);
    expect(extractDependencies('vars[interaction.key]')).toEqual(['interaction.key', 'vars.*']);
  });
  it('infers schema and collection lambda types and reports designer errors', () => {
    expect(analyzeExpression('vars.x + 1', schema)).toMatchObject({
      type: 'number',
      diagnostics: [],
    });
    expect(analyzeExpression('vars.name + 1', schema).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'TYPE_MISMATCH' }),
    );
    expect(analyzeExpression('missing + 1', schema).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_IDENTIFIER' }),
    );
    expect(analyzeExpression('map(items, x => x.amount)', schema)).toMatchObject({
      type: 'array',
      diagnostics: [],
    });
    expect(completions(schema, 'vars.').map((item) => item.label)).toEqual(['vars.name', 'vars.x']);
    expect(completions(schema, 'upper')[0]).toMatchObject({
      kind: 'function',
      insertText: 'upper()',
    });
  });
  it('escapes literal HTML and interpolated values and supports object literals in placeholders', () => {
    expect(
      renderTemplate(
        '<b>Merhaba {{customer.firstName}}, {{formatCurrency(offer.amount)}}</b>',
        { customer: { firstName: '<Fixture>' }, offer: { amount: 100 } },
        options,
      ),
    ).toBe('&lt;b&gt;Merhaba &lt;Fixture&gt;, 100,00 ₺&lt;/b&gt;');
    expect(renderTemplate('{{toString({x: "}}"})}}', {}, options)).toBe(
      '{&quot;x&quot;:&quot;}}&quot;}',
    );
    expect(() => renderTemplate('{{vars.x', facts, options)).toThrow('TEMPLATE_INVALID');
  });
  it('supports all/any/not and AND/OR builder groups in both directions', () => {
    const rule = {
      all: [
        { fact: 'vars.x', op: 'gte', value: 3 },
        {
          any: [
            { fact: 'session.customer.name', op: 'contains', value: 'Fix' },
            { not: { fact: 'vars.x', op: 'eq', value: 0 } },
          ],
        },
      ],
    };
    const expression = ruleToExpr(rule);
    expect(evaluate(expression, facts, options)).toBe(true);
    expect(evaluate(ruleToExpr(exprToRule(expression)), facts, options)).toBe(true);
    expect(
      evaluate(
        ruleToExpr({ operator: 'AND', conditions: [{ fact: 'vars.x', op: 'eq', value: 3 }] }),
        facts,
        options,
      ),
    ).toBe(true);
  });
  it('preserves expressions outside the builder grammar using an expression leaf', () => {
    expect(exprToRule('vars.x > round(2.4)')).toEqual({ $expr: 'vars.x > round(2.4)' });
  });
});
