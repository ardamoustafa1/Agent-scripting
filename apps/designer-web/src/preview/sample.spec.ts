import { describe, expect, it } from 'vitest';

import { sampleFromSchema } from './sample.js';

describe('sampleFromSchema', () => {
  it('builds a typed object from properties', () => {
    expect(
      sampleFromSchema({
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          since: { type: 'string', format: 'date' },
          balance: { type: 'number', minimum: 10 },
          count: { type: 'integer', minimum: 0.5 },
          vip: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          address: { properties: { city: { type: 'string' } } },
        },
      }),
    ).toEqual({
      name: 'sample',
      email: 'customer@example.com',
      since: '2026-01-15',
      balance: 10,
      count: 1,
      vip: true,
      tags: ['sample'],
      address: { city: 'sample' },
    });
  });

  it('prefers the schema’s own example, default, const or enum', () => {
    expect(sampleFromSchema({ type: 'string', example: 'GOLD' })).toBe('GOLD');
    expect(sampleFromSchema({ type: 'string', examples: ['A', 'B'] })).toBe('A');
    expect(sampleFromSchema({ type: 'number', default: 3 })).toBe(3);
    expect(sampleFromSchema({ const: 'fixed' })).toBe('fixed');
    expect(sampleFromSchema({ enum: ['open', 'closed'] })).toBe('open');
  });

  it('handles unions, nullable types and composition', () => {
    expect(sampleFromSchema({ anyOf: [{ type: 'integer' }, { type: 'string' }] })).toBe(1);
    expect(sampleFromSchema({ type: ['null', 'string'] })).toBe('sample');
    expect(
      sampleFromSchema({
        allOf: [{ properties: { a: { type: 'boolean' } } }, { properties: { b: { const: 2 } } }],
      }),
    ).toEqual({ a: true, b: 2 });
  });

  it('is total and bounded for odd or recursive input', () => {
    expect(sampleFromSchema(undefined)).toBeNull();
    expect(sampleFromSchema({})).toBeNull();
    expect(sampleFromSchema({ $ref: '#/definitions/x' })).toBeNull();
    const deep: Record<string, unknown> = { type: 'object', properties: {} };
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      const child = { type: 'object', properties: {} };
      (cursor['properties'] as Record<string, unknown>)['next'] = child;
      cursor = child;
    }
    expect(JSON.stringify(sampleFromSchema(deep)).length).toBeLessThan(200);
  });
});
