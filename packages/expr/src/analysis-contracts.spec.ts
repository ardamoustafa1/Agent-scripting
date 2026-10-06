import { describe, expect, it } from 'vitest';

import { accessPath, analyzeExpression, completions } from './analysis.js';
import { parseExpression } from './parser.js';
import { FunctionRegistry } from './registry.js';

import type { ContextShape } from './analysis.js';

const schema: ContextShape = {
  vars: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Quantity' },
      name: { type: 'string' },
      allowed: { type: 'boolean' },
      unknown: { type: 'unknown' },
      nil: { type: 'null' },
    },
  },
  rows: { type: 'array', items: { type: 'object', properties: { amount: { type: 'number' } } } },
  index: { type: 'number' },
};
describe('designer analysis contracts', () => {
  it.each([
    ['vars.count', 'vars.count'],
    ['vars["name"]', 'vars.name'],
    ['rows[0].amount', 'rows.0.amount'],
    ['rows[index]', undefined],
    ['vars[true]', undefined],
    ['({a: 1}).a', undefined],
    ['1 + 2', undefined],
  ] as const)('extracts only statically known paths: %s', (source, path) => {
    expect(accessPath(parseExpression(source))).toBe(path);
  });
  it.each([
    ['vars.name - 1', 'number', [{ code: 'TYPE_MISMATCH', expected: 'number', actual: 'string' }]],
    [
      'vars.count && vars.allowed',
      'boolean',
      [{ code: 'TYPE_MISMATCH', expected: 'boolean', actual: 'number' }],
    ],
    [
      'vars.count === vars.name',
      'boolean',
      [{ code: 'TYPE_MISMATCH', expected: 'number', actual: 'string' }],
    ],
    [
      'vars.count in vars.name',
      'boolean',
      [{ code: 'TYPE_MISMATCH', expected: 'array', actual: 'string' }],
    ],
    [
      'vars.count ? 1 : 2',
      'number',
      [{ code: 'TYPE_MISMATCH', expected: 'boolean', actual: 'number' }],
    ],
    ['vars.missing', 'unknown', [{ code: 'UNKNOWN_PROPERTY' }]],
    ['missing', 'unknown', [{ code: 'UNKNOWN_IDENTIFIER' }]],
    ['vars[true]', 'unknown', [{ code: 'PROPERTY_INVALID' }]],
    ['missingFunction(vars.count)', 'unknown', [{ code: 'UNKNOWN_FUNCTION' }]],
    ['round()', 'number', [{ code: 'ARGUMENT_COUNT' }]],
    ['round(1, 2, 3)', 'number', [{ code: 'ARGUMENT_COUNT' }]],
    ['sum(rows, row => row.amount)', 'number', []],
    [
      'sum(rows, row => "text")',
      'number',
      [{ code: 'TYPE_MISMATCH', expected: 'number', actual: 'string' }],
    ],
    [
      'filter(rows, row => 1)',
      'array',
      [{ code: 'TYPE_MISMATCH', expected: 'boolean', actual: 'number' }],
    ],
    ['vars.unknown + 1', 'number', []],
    ['vars.nil === vars.count', 'boolean', []],
    ['vars.count !== vars.nil', 'boolean', []],
    ['vars.count === vars.unknown', 'boolean', []],
    ['vars.allowed ? vars.count : vars.name', 'unknown', []],
  ] as const)('%s reports precise diagnostic kind and types', (source, type, diagnostics) => {
    const result = analyzeExpression(source, schema);
    expect(result.type).toBe(type);
    expect(
      result.diagnostics.map(({ position, ...rest }) => {
        expect(position).toBeGreaterThanOrEqual(0);
        return rest;
      }),
    ).toEqual(diagnostics);
  });
  it('rejects lambdas outside collection callbacks at the parser boundary', () => {
    expect(() => analyzeExpression('round(x => x)', schema)).toThrow('LAMBDA_NOT_ALLOWED');
  });
  it('does not mistake collection lambda locals for global dependencies', () => {
    const result = analyzeExpression('map(rows, row => row.amount + vars.count)', schema);
    expect(result.dependencies).toEqual(['rows', 'vars.count']);
    expect(result.type).toBe('array');
    expect(result.diagnostics).toEqual([]);
    expect(analyzeExpression('rows[index].amount', schema).dependencies).toEqual([
      'index',
      'rows.*',
    ]);
  });
  it('preserves item types after filter, map, find and homogeneous array inference', () => {
    for (const expression of [
      'filter(rows, row => true)[0].amount',
      'find(rows, row => true).amount',
      'map(rows, row => row.amount)[0]',
      '[1, 2][0]',
    ]) {
      const result = analyzeExpression(expression, schema);
      expect(result.type).toBe('number');
      expect(result.diagnostics).toEqual([]);
    }
    expect(analyzeExpression('[1, "x"][0]', schema).type).toBe('unknown');
    expect(analyzeExpression('[][0]', schema).type).toBe('unknown');
    expect(analyzeExpression('"abc"[0]', schema).type).toBe('string');
    expect(analyzeExpression('"abc".length', schema).type).toBe('number');
  });
  it('returns sorted, prefix-specific completions with descriptions and custom function metadata', () => {
    const registry = new FunctionRegistry().register({
      name: 'custom',
      parameters: [],
      returns: 'boolean',
      minArgs: 0,
      maxArgs: 0,
      implementation: () => true,
    });
    expect(completions(schema, 'vars.c', registry)).toEqual([
      {
        label: 'vars.count',
        insertText: 'vars.count',
        type: 'number',
        kind: 'variable',
        description: 'Quantity',
      },
    ]);
    expect(completions(schema, 'cust', registry)).toEqual([
      { label: 'custom', insertText: 'custom()', type: 'boolean', kind: 'function' },
    ]);
    expect(completions(schema, 'doesNotExist', registry)).toEqual([]);
    expect(completions(schema, '', registry).map((entry) => entry.label)).toEqual([
      'custom',
      'index',
      'rows',
      'vars',
      'vars.allowed',
      'vars.count',
      'vars.name',
      'vars.nil',
      'vars.unknown',
    ]);
  });
});
