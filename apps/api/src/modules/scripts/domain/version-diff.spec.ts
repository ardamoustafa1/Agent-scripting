import { describe, expect, it } from 'vitest';

import { applyPatch, jsonPatch, summarizeDiff } from './version-diff.js';

describe('version diff interoperability', () => {
  it.each([
    { from: null, to: { nested: [1, 2] } },
    { from: [1, 2, 3, 4], to: [1] },
    { from: [1], to: [2, { nested: ['a', 'b'] }] },
    { from: { removed: true, nested: { 'a~/b': 1 } }, to: { added: [1], nested: { 'a~/b': 2 } } },
    { from: { deeply: { nested: ['one', 'two'] } }, to: { deeply: { nested: ['changed'] } } },
    { from: 'string', to: false },
    { from: [null, {}, []], to: [null, { x: 1 }, [2]] },
  ])(
    'round trips heterogeneous documents with sequential RFC 6902 operations (%j)',
    ({ from, to }) => {
      const original = structuredClone(from);
      const patch = jsonPatch(from, to);
      expect(applyPatch(from, patch)).toEqual(to);
      expect(from).toEqual(original);
      expect(jsonPatch(to, to)).toEqual([]);
      expect(applyPatch(to, jsonPatch(to, from))).toEqual(from);
    },
  );
  it('supports whole-document deletion and rejects paths through scalar parents', () => {
    expect(applyPatch({ x: 1 }, [{ op: 'remove', path: '' }])).toBeUndefined();
    expect(() => applyPatch({ x: 1 }, [{ op: 'replace', path: '/x/child', value: 2 }])).toThrow(
      'invalid patch path',
    );
  });
  it('ignores editor positions but describes all stable-id content changes in deterministic order', () => {
    const from = {
      pages: [
        {
          id: 'home',
          name: 'Old',
          layout: {
            id: 'root',
            children: [
              { id: 'removed', label: 'Old' },
              { id: 'changed', label: 'Before' },
            ],
          },
        },
      ],
      variables: [{ id: 'removed' }, { id: 'changed', default: 1 }],
      dataSources: [{ id: 'old' }],
      flow: {
        nodes: [{ id: 'node', position: { x: 1, y: 2 }, type: 'page' }],
        edges: [{ id: 'old-edge' }],
      },
      i18n: { messages: { en: { removed: 'Old', changed: 'Before' } } },
      meta: { name: 'Before' },
    };
    const to = {
      pages: [
        {
          id: 'home',
          name: 'New',
          layout: { id: 'root', children: [{ id: 'added' }, { id: 'changed', label: 'After' }] },
        },
      ],
      variables: [{ id: 'added' }, { id: 'changed', default: 2 }],
      dataSources: [{ id: 'new' }],
      flow: {
        nodes: [{ id: 'node', position: { x: 10, y: 20 }, type: 'page' }],
        edges: [{ id: 'new-edge' }],
      },
      i18n: { messages: { en: { added: 'New', changed: 'After' } } },
      meta: { name: 'After' },
    };
    const result = summarizeDiff(from, to);
    expect(result).toMatchObject({
      pages: { changed: ['home'] },
      nodes: { added: ['added'], removed: ['removed'], changed: ['changed'] },
      variables: { added: ['added'], removed: ['removed'], changed: ['changed'] },
      flowNodes: { added: [], removed: [], changed: [] },
      translations: { added: ['en:added'], removed: ['en:removed'], changed: ['en:changed'] },
      metadataChanged: ['meta'],
    });
    expect(result.totalChanges).toBe(result.lines.length);
    expect(result.lines).toContain('~ component "changed" changed');
    expect(applyPatch(from, jsonPatch(from, to))).toEqual(to);
  });
  it.each([
    null,
    42,
    [],
    {
      pages: [
        null,
        'invalid',
        { id: 1, layout: null },
        { id: 'valid', layout: { children: [null, {}, { id: 'node' }] } },
      ],
      variables: [null, 5, {}, { id: 1 }],
      flow: { nodes: [null, { id: 1 }], edges: 'invalid' },
      i18n: { messages: { en: null, tr: ['invalid'] } },
    },
    { flow: { nodes: null }, i18n: {} },
    { i18n: { messages: null } },
  ])('handles partial or legacy document shapes without throwing (%j)', (document) => {
    expect(summarizeDiff(document, document).totalChanges).toBe(0);
    expect(() => summarizeDiff({}, document)).not.toThrow();
  });
});
