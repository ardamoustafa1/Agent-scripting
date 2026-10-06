import { enablePatches, produceWithPatches } from 'immer';
import { describe, expect, it } from 'vitest';

import { applyJsonPatch, JsonPatchError, toJsonPatch } from './json-patch.js';

describe('toJsonPatch', () => {
  it('converts immer patches to RFC 6902 with escaped pointers', () => {
    enablePatches();
    const [, patches] = produceWithPatches(
      { 'a/b': 1, list: [1, 2], gone: true } as Record<string, unknown>,
      (draft) => {
        draft['a/b'] = 2;
        (draft['list'] as number[]).push(3);
        delete draft['gone'];
      },
    );
    expect(toJsonPatch(patches)).toEqual(
      expect.arrayContaining([
        { op: 'replace', path: '/a~1b', value: 2 },
        { op: 'add', path: '/list/2', value: 3 },
        { op: 'remove', path: '/gone' },
      ]),
    );
  });
});

describe('applyJsonPatch', () => {
  const base = { a: { b: [1, 2, 3] }, c: 'x' };

  it('applies add / replace / remove on objects and arrays without mutating', () => {
    const next = applyJsonPatch(base, [
      { op: 'add', path: '/a/b/1', value: 9 },
      { op: 'add', path: '/a/b/-', value: 4 },
      { op: 'remove', path: '/a/b/0' },
      { op: 'replace', path: '/a/b/0', value: 8 },
      { op: 'add', path: '/d', value: { e: 1 } },
      { op: 'replace', path: '/c', value: 'y' },
      { op: 'remove', path: '/d/e' },
    ]);
    expect(next).toEqual({ a: { b: [8, 2, 3, 4] }, c: 'y', d: {} });
    expect(base).toEqual({ a: { b: [1, 2, 3] }, c: 'x' });
  });

  it('copies inserted values', () => {
    const value = { deep: [1] };
    const next = applyJsonPatch({ list: [] as unknown[] }, [{ op: 'add', path: '/list/0', value }]);
    value.deep.push(2);
    expect(next.list[0]).toEqual({ deep: [1] });
  });

  it.each([
    ['root replace', { op: 'replace', path: '', value: 1 }],
    ['missing parent', { op: 'add', path: '/x/y', value: 1 }],
    ['primitive parent', { op: 'add', path: '/c/y', value: 1 }],
    ['traversal through primitive', { op: 'add', path: '/c/y/z', value: 1 }],
    ['missing key', { op: 'remove', path: '/zzz' }],
    ['bad index', { op: 'replace', path: '/a/b/x', value: 1 }],
    ['leading zero index', { op: 'remove', path: '/a/b/01' }],
    ['index past end', { op: 'replace', path: '/a/b/3', value: 1 }],
    ['add past end', { op: 'add', path: '/a/b/5', value: 1 }],
    ['dash on remove', { op: 'remove', path: '/a/b/-' }],
    ['dash while traversing', { op: 'add', path: '/a/b/-/x', value: 1 }],
  ] as const)('rejects %s', (_label, operation) => {
    expect(() => applyJsonPatch(base, [operation])).toThrow(JsonPatchError);
  });

  it('exposes the failing operation', () => {
    const operation = { op: 'remove', path: '/nope' } as const;
    try {
      applyJsonPatch(base, [operation]);
    } catch (error) {
      expect(error).toMatchObject({ name: 'JsonPatchError', operation });
    }
  });
});
