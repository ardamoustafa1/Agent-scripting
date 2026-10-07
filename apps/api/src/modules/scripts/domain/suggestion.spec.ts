import { describe, expect, it } from 'vitest';

import { buildGuards, guardsHold, valueAt } from './suggestion.js';

const doc = () => ({
  name: 'Home',
  pages: [{ id: 'a', title: 'A' }, { id: 'b' }],
  meta: { tags: ['x'] },
});

describe('valueAt', () => {
  it('reads objects and arrays and returns undefined for anything missing', () => {
    expect(valueAt(doc(), '/pages/1/id')).toBe('b');
    expect(valueAt(doc(), '/meta/tags/0')).toBe('x');
    expect(valueAt(doc(), '/pages/5')).toBeUndefined();
    expect(valueAt(doc(), '/name/length')).toBeUndefined();
    expect(valueAt(doc(), '/pages/x')).toBeUndefined();
  });
});

describe('suggestion guards', () => {
  const ops = [
    { op: 'replace', path: '/name', value: 'Next' },
    { op: 'remove', path: '/pages/1' },
    { op: 'add', path: '/pages/-', value: { id: 'c' } },
    { op: 'add', path: '/meta/owner', value: 'me' },
    { op: 'add', path: '/meta/tags/1', value: 'y' },
  ] as const;

  it('records the value, absence or array length each operation relies on', () => {
    expect(buildGuards(doc(), ops)).toEqual([
      { kind: 'value', path: '/name', value: 'Home' },
      { kind: 'value', path: '/pages/1', value: { id: 'b' } },
      { kind: 'length', path: '/pages', length: 2 },
      { kind: 'absent', path: '/meta/owner' },
      { kind: 'length', path: '/meta/tags', length: 1 },
    ]);
  });

  it('holds on an unchanged document, regardless of key order', () => {
    const guards = buildGuards(doc(), ops);
    expect(guardsHold(doc(), guards)).toBe(true);
    const reordered = {
      meta: { tags: ['x'] },
      pages: [{ title: 'A', id: 'a' }, { id: 'b' }],
      name: 'Home',
    };
    expect(guardsHold(reordered, guards)).toBe(true);
  });

  it.each([
    ['a replaced value changed', (d: ReturnType<typeof doc>) => void (d.name = 'Other')],
    [
      'a removed item changed',
      (d: ReturnType<typeof doc>) => void ((d.pages[1] as { id: string }).id = 'z'),
    ],
    ['an array grew', (d: ReturnType<typeof doc>) => void d.pages.push({ id: 'q' })],
    [
      'an added key appeared',
      (d: ReturnType<typeof doc>) => void Object.assign(d.meta, { owner: 'someone' }),
    ],
    ['the target vanished', (d: ReturnType<typeof doc>) => void d.pages.splice(1, 1)],
  ])('is stale when %s', (_name, change) => {
    const guards = buildGuards(doc(), ops);
    const changed = doc();
    change(changed);
    expect(guardsHold(changed, guards)).toBe(false);
  });

  it('treats a removed-then-missing value guard as stale, not as success', () => {
    const guards = buildGuards(doc(), [{ op: 'remove', path: '/pages/9' }]);
    expect(guards).toEqual([{ kind: 'value', path: '/pages/9', value: undefined }]);
    expect(guardsHold(doc(), guards)).toBe(false);
  });
});
