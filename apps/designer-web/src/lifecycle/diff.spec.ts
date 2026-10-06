import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';

import { editorFixture } from '../editor/fixtures.js';

import { compareNodes, compareItems } from './diff.js';

describe('semantic visual diff', () => {
  it('matches stable IDs rather than object property order', () => {
    expect(
      compareItems([{ id: 'a', x: 1, y: 2 }], [{ y: 2, x: 1, id: 'a' }], (v) => v.id)[0]?.change,
    ).toBe('unchanged');
  });
  it('separates added, deleted and changed nodes without flagging their untouched container', () => {
    const a = ScriptDocumentSchema.parse(editorFixture(2).document),
      b = structuredClone(a);
    const root = b.pages[0]?.layout;
    if (!root) throw Error('fixture');
    root.children = root.children?.filter((n) => n['id'] !== 'fixture-0');
    root.children?.push({ id: 'new-node', type: 'box', props: {}, bindings: [], events: {} });
    const next = root.children?.find((n) => n['id'] === 'btn-next');
    if (next) (next['props'] as Record<string, unknown>)['labelKey'] = 'common.previous';
    const changes = compareNodes(a, b);
    expect(changes.get('fixture-0')).toBe('removed');
    expect(changes.get('new-node')).toBe('added');
    expect(changes.get('btn-next')).toBe('changed');
    expect(changes.get(root.id)).toBe('unchanged');
  });
  it('identifies movement across parents even when node props are unchanged', () => {
    const a = ScriptDocumentSchema.parse(editorFixture(2).document),
      b = structuredClone(a);
    const root = b.pages[0]?.layout,
      child = root?.children?.find((n) => n['id'] === 'fixture-0'),
      next = root?.children?.find((n) => n['id'] === 'btn-next');
    if (!root || !child || !next) throw Error('fixture');
    root.children = [child];
    child['children'] = [next];
    expect(compareNodes(a, b).get(String(next['id']))).toBe('changed');
  });
});
