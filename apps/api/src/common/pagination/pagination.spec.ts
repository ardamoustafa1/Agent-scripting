import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from '../errors/domain-errors.js';

import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  keysetOrderBy,
  keysetWhere,
  listQuerySchema,
  pageSchema,
  toPage,
} from './pagination.js';

const ID_A = '01928f3a-0000-7000-8000-000000000001';
const ID_B = '01928f3a-0000-7000-8000-000000000002';
const Query = listQuerySchema(['createdAt', 'name'], { status: z.enum(['a', 'b']).optional() });

describe('listQuerySchema', () => {
  it('applies defaults (limit 25, first field descending)', () => {
    expect(Query.parse({})).toEqual({
      limit: 25,
      sort: { field: 'createdAt', direction: 'desc' },
      filters: {},
    });
  });

  it('coerces limit, parses sort and keeps filters', () => {
    expect(Query.parse({ limit: '10', sort: 'name', status: 'a' })).toEqual({
      limit: 10,
      sort: { field: 'name', direction: 'asc' },
      filters: { status: 'a' },
    });
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { sort: 'password' },
    { unknown: 'x' },
    { status: 'c' },
  ])('rejects %j', (input) => {
    expect(Query.safeParse(input).success).toBe(false);
  });

  it('accepts an explicit default sort', () => {
    expect(listQuerySchema(['key'], {}, 'key').parse({}).sort).toEqual({
      field: 'key',
      direction: 'asc',
    });
  });

  it('binds the cursor to the sort expression', () => {
    const cursor = encodeCursor({ s: 'name', v: 'x', id: ID_A });
    expect(Query.parse({ sort: 'name', cursor }).cursor).toEqual({ s: 'name', v: 'x', id: ID_A });
    expect(() => Query.parse({ sort: '-name', cursor })).toThrow(InvalidCursorError);
  });
});

describe('cursor encoding', () => {
  it('round-trips', () => {
    const payload = { s: '-createdAt', v: '2026-10-01T00:00:00.000Z', id: ID_A };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it.each([
    'not-base64!',
    Buffer.from('{"s":1}').toString('base64url'),
    Buffer.from('[]').toString('base64url'),
  ])('rejects %s', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(DomainError);
  });
});

describe('keyset helpers', () => {
  it('returns no condition on the first page', () => {
    expect(keysetWhere(Query.parse({}))).toBeUndefined();
  });

  it('builds tie-broken conditions in both directions and revives dates', () => {
    const date = '2026-10-01T00:00:00.000Z';
    const desc = Query.parse({ cursor: encodeCursor({ s: '-createdAt', v: date, id: ID_A }) });
    expect(keysetWhere(desc)).toEqual({
      OR: [{ createdAt: { lt: new Date(date) } }, { createdAt: new Date(date), id: { lt: ID_A } }],
    });
    const asc = Query.parse({
      sort: 'name',
      cursor: encodeCursor({ s: 'name', v: 'n', id: ID_A }),
    });
    expect(keysetWhere(asc)).toEqual({
      OR: [{ name: { gt: 'n' } }, { name: 'n', id: { gt: ID_A } }],
    });
    expect(keysetOrderBy(asc)).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });

  it('handles null sort values', () => {
    const query = Query.parse({
      sort: 'name',
      cursor: encodeCursor({ s: 'name', v: null, id: ID_A }),
    });
    expect(keysetWhere(query)).toEqual({ id: { gt: ID_A } });
  });
});

describe('toPage', () => {
  const rows = [
    { id: ID_A, createdAt: new Date('2026-10-02T00:00:00Z'), n: 2n },
    { id: ID_B, createdAt: new Date('2026-10-01T00:00:00Z'), n: 1n },
  ];

  it('emits a cursor when more rows exist', () => {
    const page = toPage(
      rows,
      { limit: 1, sort: { field: 'createdAt', direction: 'desc' } },
      (row) => row.id,
      (row) => row.createdAt,
    );
    expect(page.data).toEqual([ID_A]);
    expect(page.page.sort).toBe('-createdAt');
    expect(decodeCursor(page.page.nextCursor ?? '')).toEqual({
      s: '-createdAt',
      v: '2026-10-02T00:00:00.000Z',
      id: ID_A,
    });
  });

  it('ends without a cursor and converts bigint values', () => {
    expect(
      toPage(
        rows,
        { limit: 5, sort: { field: 'createdAt', direction: 'asc' } },
        (row) => row.id,
        (row) => row.n,
      ).page.nextCursor,
    ).toBeNull();
    const page = toPage(
      rows,
      { limit: 1, sort: { field: 'n', direction: 'asc' } },
      (row) => row.id,
      (row) => row.n,
    );
    expect(decodeCursor(page.page.nextCursor ?? '').v).toBe(2);
  });

  it('builds page schemas', () => {
    expect(
      pageSchema(z.string()).parse({ data: ['a'], page: { limit: 1, nextCursor: null, sort: 'x' } })
        .data,
    ).toEqual(['a']);
  });
});
