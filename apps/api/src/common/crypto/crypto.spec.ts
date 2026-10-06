import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hex } from './canonical-json.js';
import { auditDiff, redact, REDACTED } from './redact.js';

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined/functions', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined, f: () => 1 } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('normalizes dates, bigints, bytes, non-finite numbers and sparse arrays', () => {
    expect(
      canonicalJson({
        d: new Date('2026-10-01T00:00:00Z'),
        n: 12n,
        b: new Uint8Array([1, 2]),
        x: Number.NaN,
        a: [undefined],
      }),
    ).toBe('{"a":[null],"b":"AQI=","d":"2026-10-01T00:00:00.000Z","n":"12","x":null}');
  });

  it('is stable under key order', () => {
    expect(sha256Hex(canonicalJson({ a: 1, b: 2 }))).toBe(sha256Hex(canonicalJson({ b: 2, a: 1 })));
    expect(sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('redact', () => {
  it('masks sensitive keys deeply', () => {
    expect(
      redact({ name: 'x', email: 'a@b.c', nested: [{ notes: 'n', ok: 1 }], when: new Date(0) }),
    ).toEqual({
      name: 'x',
      email: REDACTED,
      nested: [{ notes: REDACTED, ok: 1 }],
      when: '1970-01-01T00:00:00.000Z',
    });
    expect(redact('plain')).toBe('plain');
  });

  it('diffs changed keys only, ignoring bookkeeping fields', () => {
    expect(
      auditDiff(
        { name: 'a', status: 'x', version: 1, email: 'old' },
        { name: 'b', status: 'x', version: 2, email: 'new' },
      ),
    ).toEqual({
      before: { name: 'a', email: REDACTED },
      after: { name: 'b', email: REDACTED },
    });
    expect(auditDiff(null, { email: 'x' })).toEqual({ before: null, after: { email: REDACTED } });
    expect(auditDiff({ a: 1 }, null)).toEqual({ before: { a: 1 }, after: null });
  });
});
