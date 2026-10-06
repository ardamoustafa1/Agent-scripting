import { expect, it } from 'vitest';

import { sanitizeJson } from './sanitize.js';
import { toBigInt, toInt } from './scalars.js';

it('normalizes integer driver representations without losing ledger sequence precision', () => {
  expect(toBigInt('-9007199254740993')).toBe(-9007199254740993n);
  expect(toBigInt(42)).toBe(42n);
  expect(toInt('-42')).toBe(-42);
  for (const invalid of [undefined, null, 0.5, Number.NaN, '1.2', '1e3'])
    expect(() => toBigInt(invalid)).toThrow(TypeError);
  expect(() => toInt(9007199254740992n)).toThrow(RangeError);
  expect(() => toInt(-9007199254740992n)).toThrow(RangeError);
});
it('keeps audit JSON stable through PostgreSQL-compatible JSON serialization', () => {
  const source = {
    time: new Date('2026-10-06T00:00:00Z'),
    sequence: 9007199254740993n,
    values: [undefined, () => undefined, Infinity, -0],
    enabled: true,
    omitted: undefined,
    nul: `a${String.fromCharCode(0)}b`,
  };
  expect(sanitizeJson(source)).toEqual({
    time: '2026-10-06T00:00:00.000Z',
    sequence: '9007199254740993',
    values: [null, null, null, 0],
    enabled: true,
    nul: 'a\uFFFDb',
  });
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const encoded = JSON.stringify(sanitizeJson(cyclic));
  expect(encoded).toContain('[TRUNCATED]');
  expect(JSON.stringify(JSON.parse(encoded) as unknown)).toBe(encoded);
});
