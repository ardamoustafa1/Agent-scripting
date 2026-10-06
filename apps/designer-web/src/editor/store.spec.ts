import { describe, it, expect } from 'vitest';

import { walkNodes } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from './store.js';

function fixture() {
  let sequence = 0;
  return new EditorStore(minimalScript(), new Set(), () => `test-${++sequence}`);
}
describe('editor document transactions', () => {
  it('inserts consent with document translations and no validation error', () => {
    const store = fixture();
    const before = store.getSnapshot().document;
    store.insert('explicitConsent', 'home-root');
    expect(store.issues().filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(
      store.getSnapshot().document.i18n.messages['tr']?.['components.consentLabel'],
    ).toBeTruthy();
    expect(
      store.getSnapshot().document.i18n.messages['en']?.['components.consentLabel'],
    ).toBeTruthy();
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
  });
  it('inserts a repeater with an array variable without overwriting existing fields', () => {
    const store = fixture();
    store.edit((document) => {
      document.variables.push({
        key: 'items',
        type: 'string',
        scope: 'session',
        default: 'keep',
        classification: 'internal',
        pii: false,
        persist: false,
      });
    });
    const before = store.getSnapshot().document;
    store.insert('repeater', 'home-root');
    const node = store.node(store.getSnapshot().selection[0]!);
    const variable = store
      .getSnapshot()
      .document.variables.find((v) => v.key === node?.props['arrayVariable']);
    expect(variable?.type).toBe('array');
    expect(variable?.default).toEqual([]);
    expect(store.getSnapshot().document.variables.find((v) => v.key === 'items')?.default).toBe(
      'keep',
    );
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
  });
  it('does not ungroup only the first item of a multi-root selection', () => {
    const store = fixture();
    store.select('btn-next');
    store.group();
    const group = store.getSnapshot().selection[0]!;
    store.insert('text', 'home-root');
    const text = store.getSnapshot().selection[0]!;
    store.select(group);
    store.select(text, true);
    const before = store.getSnapshot().document;
    expect(() => {
      store.ungroup();
    }).toThrow('VERBIS_UNGROUP_INVALID');
    expect(store.getSnapshot().document).toBe(before);
  });
  it('ungroups the selected root when its descendant was selected first', () => {
    const store = fixture();
    store.select('btn-next');
    store.group();
    const group = store.getSnapshot().selection[0]!;
    store.select('btn-next');
    store.select(group, true);
    store.ungroup();
    expect(store.node('home-root')?.children?.map((node) => node.id)).toEqual(['btn-next']);
  });
  it('groups siblings in canvas order even when they are selected in reverse order', () => {
    const store = fixture();
    store.insert('text', 'home-root');
    const middle = store.getSnapshot().selection[0]!;
    store.insert('heading', 'home-root');
    const last = store.getSnapshot().selection[0]!;
    store.select(last);
    store.select('btn-next', true);
    const before = store.getSnapshot().document;
    store.group();
    const group = store.getSnapshot().selection[0]!;
    expect(store.node('home-root')?.children?.map((node) => node.id)).toEqual([group, middle]);
    expect(store.node(group)?.children?.map((node) => node.id)).toEqual(['btn-next', last]);
    store.ungroup();
    expect(store.node('home-root')?.children?.map((node) => node.id)).toEqual([
      'btn-next',
      last,
      middle,
    ]);
    store.undo();
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
  });
  it('undoes and redoes a batched sibling reorder without creating an extra history entry', () => {
    const store = fixture();
    store.insert('box', 'home-root');
    store.insert('box', 'home-root');
    const id = store.getSnapshot().selection[0]!;
    const before = store.getSnapshot().document;
    store.batch(() => {
      store.move(id, 'home-root', 1);
    });
    const after = store.getSnapshot().document;
    expect(after).not.toEqual(before);
    expect(store.getSnapshot().history).toBe(3);
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
    store.redo();
    expect(store.getSnapshot().document).toEqual(after);
  });
  it('groups a drag into one undo step and restores node position', () => {
    const store = fixture();
    store.insert('box', 'home-root');
    const box = store.getSnapshot().selection[0];
    expect(box).toBeDefined();
    if (!box) throw new Error('fixture');
    const before = store.getSnapshot().document;
    store.batch(() => {
      store.move('btn-next', box);
      store.update(box, (node) => {
        node.style = { base: { gap: 'lg' } };
      });
    });
    expect(store.getSnapshot().history).toBe(2);
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
    store.redo();
    expect(store.location('btn-next')?.parent?.id).toBe(box);
  });
  it('duplicates nested nodes with fresh ids and restores grouping atomically', () => {
    const store = fixture();
    store.select('btn-next');
    store.duplicate();
    const ids: string[] = [];
    walkNodes(store.getSnapshot().document, ({ node }) => {
      ids.push(node.id);
      return true;
    });
    expect(new Set(ids).size).toBe(ids.length);
    const copy = store.getSnapshot().selection[0];
    if (!copy) throw new Error('fixture');
    store.select('btn-next', true);
    store.group();
    const group = store.getSnapshot().selection[0];
    expect(group && store.node(group)?.children).toHaveLength(2);
    store.ungroup();
    expect(store.node('home-root')?.children).toHaveLength(2);
    store.undo();
    expect(group && store.node(group)?.children).toHaveLength(2);
  });
  it('blocks ancestor cycles, root moves and linked writes', () => {
    const store = fixture();
    store.insert('box', 'home-root');
    const child = store.getSnapshot().selection[0];
    if (!child) throw new Error('fixture');
    expect(store.canDrop(child, 'box', 'home-root')).toBe(false);
    expect(store.canDrop('btn-next', 'box')).toBe(false);
    const linked = new EditorStore(minimalScript(), new Set(['home']));
    expect(() => {
      linked.update('btn-next', (n) => {
        n.props['disabled'] = true;
      });
    }).toThrow();
    expect(linked.canDrop('home-root', 'box')).toBe(false);
  });
  it('publishes one consistent snapshot for a grouped command', () => {
    const store = fixture();
    let calls = 0;
    store.subscribe(() => {
      calls++;
      expect(store.node('home-root')).toBe(store.getSnapshot().document.pages[0]?.layout);
    });
    store.batch(() => {
      store.insert('box', 'home-root');
      store.insert('box', 'home-root');
    });
    expect(calls).toBe(1);
  });
  it('rolls back a failed batch and keeps redo history intact', () => {
    const store = fixture();
    store.insert('box', 'home-root');
    store.undo();
    const before = store.getSnapshot().document;
    expect(() => {
      store.batch(() => {
        store.insert('box', 'home-root');
        throw new Error('fixture failure');
      });
    }).toThrow();
    expect(store.getSnapshot().document).toBe(before);
    expect(store.getSnapshot().future).toBe(1);
    store.redo();
    expect(store.node('home-root')?.children).toHaveLength(2);
  });
  it('retains more than 100 edits without a bounded history', () => {
    const store = fixture();
    for (let i = 0; i < 130; i++)
      store.update('home-root', (node) => {
        node.style = { base: { columns: (i % 12) + 1 } };
      });
    expect(store.getSnapshot().history).toBe(130);
    for (let i = 0; i < 130; i++) store.undo();
    expect(store.getSnapshot().document).toEqual(fixture().getSnapshot().document);
  });
});
