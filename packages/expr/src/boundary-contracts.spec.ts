import { describe, expect, it } from 'vitest';

import { age, formatCurrency } from './dates.js';
import { Budget, array, equal, numeric, text } from './runtime.js';
import { valueType, type Value } from './types.js';

import {
  analyzeExpression,
  compileExpression,
  createDefaultRegistry,
  evaluate,
  exprToRule,
  renameVariableExpression,
  renderTemplate,
  tryEvaluate,
} from './index.js';

const options = { budgetClock: () => 0 };
describe('expression resource and conversion boundaries', () => {
  it.each([
    [true, 'boolean'],
    [1, 'number'],
    ['a', 'string'],
    [null, 'null'],
    [[], 'array'],
    [{}, 'object'],
  ] as const)('classifies %j exactly', (value, type) => {
    expect(valueType(value as Value)).toBe(type);
  });
  it('rejects objects with oversized keys and collections before exposing them to expressions', () => {
    const budget = new Budget({
      ...options,
      limits: { maxCollectionLength: 2, maxStringLength: 3 },
    });
    expect(() => budget.snapshot({ long: 1 })).toThrow('STRING_LIMIT');
    expect(() => budget.snapshot({ a: 1, b: 2, c: 3 })).toThrow('COLLECTION_LIMIT');
    expect(() => budget.snapshot([1, 2, 3])).toThrow('COLLECTION_LIMIT');
    expect(() => budget.snapshot(Symbol('invalid'))).toThrow('CONTEXT_INVALID');
    expect(() => numeric(null)).toThrow('TYPE_NUMBER');
    expect(() => text(1)).toThrow('TYPE_STRING');
    expect(() => array({})).toThrow('TYPE_ARRAY');
  });
  it('counts two, three and four byte UTF-8 output exactly', () => {
    for (const [value, bytes] of [
      ['é', 4],
      ['界', 5],
      ['😀', 6],
    ] as const) {
      expect(new Budget({ ...options, limits: { maxOutputBytes: bytes } }).output(value)).toBe(
        value,
      );
      expect(() =>
        new Budget({ ...options, limits: { maxOutputBytes: bytes - 1 } }).output(value),
      ).toThrow('OUTPUT_LIMIT');
    }
  });
  it('compares structured values with matching keys, lengths and array types', () => {
    expect(equal([1], { 0: 1 })).toBe(false);
    expect(equal({ a: 1 }, { b: 1 })).toBe(false);
    expect(equal([1], [1, 2])).toBe(false);
    expect(equal({ a: [null] }, { a: [null] })).toBe(true);
    expect(equal({ a: 1 }, { a: 2 })).toBe(false);
  });
  it.each(['"a"[8]', '[1][8]', '"a"["oops"]', '[1]["oops"]'])(
    'returns null for absent or non-index access %s',
    (source) => {
      expect(evaluate(source, {}, options)).toBeNull();
    },
  );
  it.each(['{a:1}[true]', '{a:1}[null]'])('rejects invalid computed keys %s', (source) => {
    expect(tryEvaluate(source, {}, options)).toMatchObject({
      ok: false,
      error: { code: 'PROPERTY_INVALID' },
    });
  });
  it('checks fresh compilation overrides and exposes safe failures from extensions', () => {
    const compiled = compileExpression('1 + 2', options);
    expect(compiled.evaluate()).toBe(3);
    expect(() => compiled.evaluate({}, { limits: { maxSourceLength: 1 } })).toThrow('SOURCE_LIMIT');
    expect(tryEvaluate('1', {}, { now: () => NaN })).toMatchObject({
      ok: false,
      error: { code: 'DATE_INVALID' },
    });
    const registry = createDefaultRegistry().register({
      name: 'broken',
      parameters: [],
      returns: 'null',
      minArgs: 0,
      maxArgs: 0,
      implementation: () => {
        throw new Error('private details');
      },
    });
    expect(tryEvaluate('broken()', {}, { ...options, registry })).toEqual({
      ok: false,
      error: { code: 'EVALUATION_FAILED', position: 0 },
    });
    expect(tryEvaluate('switch(1, 2, 3, 4, 5)', {}, options)).toMatchObject({
      ok: false,
      error: { code: 'ARGUMENT_COUNT' },
    });
    expect(tryEvaluate('toNumber("1e999")', {}, options)).toMatchObject({
      ok: false,
      error: { code: 'NUMBER_INVALID' },
    });
  });
  it('preserves registry implementations independently from interpreter short circuits', () => {
    const registry = createDefaultRegistry(),
      context = { budget: new Budget(options), now: 0, locale: 'en' as const, lambda: () => null };
    expect(registry.get('if').implementation([true, 'yes', 'no'], context)).toBe('yes');
    expect(registry.get('if').implementation([false, 'yes', 'no'], context)).toBe('no');
    expect(registry.get('switch').implementation([1, 1, 'yes', 'no'], context)).toBeNull();
    expect(() => registry.get('between').implementation([1, []], context)).toThrow(
      'ARGUMENT_INVALID',
    );
  });
  it('does not lose escaped string keys during renaming', () => {
    expect(
      renameVariableExpression('vars["old\\u004eame"] + vars.oldName', 'oldName', 'next'),
    ).toBe('vars["next"] + vars.next');
  });
  it.each(['vars.x == 1', 'vars.x != 1'])(
    'recognizes non-strict equality in builder conversion %s',
    (source) => {
      expect(exprToRule(source)).toMatchObject({
        fact: 'vars.x',
        op: source.includes('!=') ? 'neq' : 'eq',
        value: 1,
      });
    },
  );
  it.each(['(vars.x > 1) && vars.flag', '(vars.x > 1) || vars.flag', '!(1 + 2)'])(
    'retains an expression that cannot be represented as a rule %s',
    (source) => {
      expect(exprToRule(source)).toEqual({ $expr: source });
    },
  );
  it('diagnoses incomplete collection and conditional calls without crashing', () => {
    expect(analyzeExpression('filter()').diagnostics).toEqual([
      { code: 'ARGUMENT_COUNT', position: 0 },
    ]);
    expect(analyzeExpression('find()').type).toBe('unknown');
    expect(analyzeExpression('find([] , x => true)').type).toBe('unknown');
    expect(analyzeExpression('if(true)').type).toBe('unknown');
    expect(analyzeExpression('if(true, 1, "x")').type).toBe('unknown');
  });
  it('enforces template size and escapes delimiter characters inside quoted expressions', () => {
    expect(() =>
      renderTemplate('12345', {}, { ...options, limits: { maxStringLength: 4 } }),
    ).toThrow('STRING_LIMIT');
    expect(() =>
      renderTemplate(
        '{{ x }}{{ x }}',
        { x: 'long' },
        { ...options, limits: { maxStringLength: 20 } },
      ),
    ).not.toThrow();
    expect(renderTemplate(String.raw`{{ "a\"}}b" }}`, {}, options)).toBe('a&quot;}}b');
    expect(renderTemplate('', {}, options)).toBe('');
  });
  it('rejects non-finite age clocks and enormous currencies', () => {
    expect(() => age('2000-01-01', NaN)).toThrow('DATE_INVALID');
    expect(() => formatCurrency(1e15, 'en')).toThrow('CURRENCY_INVALID');
  });
});
