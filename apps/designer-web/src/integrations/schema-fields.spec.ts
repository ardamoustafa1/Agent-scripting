import { describe, expect, it } from 'vitest';

import { inferSchema } from './importers.js';
import {
  rowsFromSchema,
  sampleFromSchema,
  schemaFromRows,
  validFieldName,
} from './schema-fields.js';

describe('schema rows', () => {
  it('reads flat and nested fields with kinds and required flags', () => {
    const schema = {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
        eta: { type: 'string', format: 'date' },
        count: { type: 'integer' },
        courier: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        events: { type: 'array', items: { type: 'string' } },
      },
    };
    const rows = rowsFromSchema(schema)!;
    expect(rows.map(({ name, kind, required }) => [name, kind, required])).toEqual([
      ['status', 'string', true],
      ['eta', 'date', false],
      ['count', 'integer', false],
      ['courier.name', 'string', true],
      ['events', 'array', false],
    ]);
    // Leaf details (enum, items) survive the round trip.
    expect(schemaFromRows(rows, schema)).toEqual(schema);
  });
  it('round-trips schemas inferred from sample responses', () => {
    const inferred = inferSchema({ id: 7, tags: ['a'], owner: { email: 'x@example.test' } });
    expect(schemaFromRows(rowsFromSchema(inferred)!, inferred)).toEqual(inferred);
  });
  it('changes a kind without leaving stale keywords and builds nested objects from dots', () => {
    const rows = rowsFromSchema({
      type: 'object',
      properties: { eta: { type: 'string', format: 'date' } },
    })!;
    rows[0]!.kind = 'number';
    rows.push({ name: 'customer.segment', kind: 'string', required: true });
    expect(schemaFromRows(rows)).toEqual({
      type: 'object',
      properties: {
        eta: { type: 'number' },
        customer: {
          type: 'object',
          properties: { segment: { type: 'string' } },
          required: ['segment'],
        },
      },
    });
  });
  it('refuses schemas the rows cannot represent and accepts the empty schema', () => {
    expect(rowsFromSchema({})).toEqual([]);
    expect(rowsFromSchema({ oneOf: [{ type: 'string' }] })).toBeNull();
    expect(rowsFromSchema({ type: 'object', patternProperties: {}, properties: {} })).toBeNull();
    expect(
      rowsFromSchema({ type: 'object', properties: { 'bad-key': { type: 'string' } } }),
    ).toBeNull();
    expect(validFieldName('courier.full_name')).toBe(true);
    expect(validFieldName('courier..name')).toBe(false);
  });
});

describe('sampleFromSchema', () => {
  it('produces data that matches each kind', () => {
    expect(
      sampleFromSchema({
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open'] },
          eta: { type: 'string', format: 'date' },
          count: { type: 'integer' },
          ok: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      }),
    ).toEqual({ status: 'open', eta: '2026-01-01', count: 1, ok: true, tags: ['örnek'] });
    expect(sampleFromSchema(null)).toBeNull();
  });
});
