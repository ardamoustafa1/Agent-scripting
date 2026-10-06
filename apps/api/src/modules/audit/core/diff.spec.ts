import { describe, expect, it } from 'vitest';

import { maskPii, patchDiff, snapshotDiff } from './diff.js';

describe('PII-masked diffs', () => {
  it('masks sensitive keys at any depth and normalizes values', () => {
    expect(
      maskPii({
        email: 'a@b.c',
        profile: { phone: '555', nested: [{ password: 'x', ok: 1 }] },
        at: new Date('2026-01-01T00:00:00Z'),
        big: 10n,
        fn: () => 1,
        missing: undefined,
      }),
    ).toEqual({
      email: '[REDACTED]',
      profile: { phone: '[REDACTED]', nested: [{ password: '[REDACTED]', ok: 1 }] },
      at: '2026-01-01T00:00:00.000Z',
      big: '10',
    });
  });

  it('honours extra classified keys (script variables)', () => {
    expect(
      maskPii({ cardHolder: 'X', amount: 3 }, { extraSensitive: new Set(['cardHolder']) }),
    ).toEqual({
      cardHolder: '[REDACTED]',
      amount: 3,
    });
  });

  it('snapshot: only changed keys, masked; bookkeeping keys ignored', () => {
    expect(
      snapshotDiff(
        { name: 'a', email: 'x@y.z', version: 1, same: true },
        { name: 'b', email: 'q@y.z', version: 2, same: true, added: 1 },
      ),
    ).toEqual({
      mode: 'snapshot',
      before: { name: 'a', email: '[REDACTED]' },
      after: { name: 'b', email: '[REDACTED]', added: 1 },
    });
  });

  it('snapshot: create/delete keep the whole masked object', () => {
    expect(snapshotDiff(null, { email: 'x', n: 1 })).toEqual({
      mode: 'snapshot',
      before: null,
      after: { email: '[REDACTED]', n: 1 },
    });
    expect(snapshotDiff({ n: 1 }, null)).toEqual({
      mode: 'snapshot',
      before: { n: 1 },
      after: null,
    });
  });

  it('patch: RFC 6902 operations with escaped paths and masked values', () => {
    expect(
      patchDiff(
        { a: 1, keep: 2, 'x/y': 1, profile: { email: 'old@x', city: 'A' }, gone: true, version: 1 },
        {
          a: 2,
          keep: 2,
          'x/y': 2,
          profile: { email: 'new@x', city: 'B' },
          fresh: { token: 't' },
          version: 2,
        },
      ),
    ).toEqual({
      mode: 'patch',
      ops: [
        { op: 'remove', path: '/gone' },
        { op: 'replace', path: '/a', value: 2 },
        { op: 'add', path: '/fresh', value: { token: '[REDACTED]' } },
        { op: 'replace', path: '/profile/city', value: 'B' },
        { op: 'replace', path: '/profile/email', value: '[REDACTED]' },
        { op: 'replace', path: '/x~1y', value: 2 },
      ],
    });
  });

  it('patch: a sensitive subtree is masked whole', () => {
    expect(patchDiff({ customer: { name: 'A' } }, { customer: { name: 'B' } }).ops).toEqual([
      { op: 'replace', path: '/customer/name', value: '[REDACTED]' },
    ]);
    expect(patchDiff({ list: [1] }, { list: [1, 2] }).ops).toEqual([
      { op: 'replace', path: '/list', value: [1, 2] },
    ]);
    expect(patchDiff(null, { a: 1 }).ops).toEqual([{ op: 'replace', path: '', value: { a: 1 } }]);
    expect(patchDiff({ a: 1 }, { a: 1 }).ops).toEqual([]);
  });
});
