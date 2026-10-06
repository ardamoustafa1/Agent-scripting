import { expect, it, vi } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from './store.js';

function fixture() {
  let id = 0;
  return new EditorStore(minimalScript(), new Set(), () => `synthetic-${++id}`);
}
it('suspends editing and shared undo while collaboration is not ready, then detaches shared history', () => {
  const store = fixture(),
    undo = vi.fn(),
    redo = vi.fn();
  const detach = store.attachSharedHistory(undo, redo);
  store.setWriteSuspended(true);
  expect(() => {
    store.insert('text', 'home-root');
  }).toThrow('VERBIS_COLLABORATION_NOT_READY');
  store.undo();
  store.redo();
  expect(undo).not.toHaveBeenCalled();
  expect(redo).not.toHaveBeenCalled();
  store.setWriteSuspended(false);
  store.undo();
  store.redo();
  expect(undo).toHaveBeenCalledOnce();
  expect(redo).toHaveBeenCalledOnce();
  detach();
  store.insert('text', 'home-root');
  store.undo();
  store.redo();
  expect(store.getSnapshot().history).toBe(1);
  expect(undo).toHaveBeenCalledOnce();
});
it('applies remote changes, drops deleted selections and switches to a surviving page', () => {
  const store = fixture();
  store.select('btn-next');
  const remote = fixture();
  remote.addPage('Remote page');
  const document = structuredClone(remote.getSnapshot().document);
  document.pages.splice(0, 1);
  store.applyRemote(document);
  expect(store.getSnapshot().selection).toEqual([]);
  expect(store.getSnapshot().pageId).toBe(document.pages[0]!.id);
  expect(store.getSnapshot().history).toBe(0);
  expect(store.getSnapshot().revision).toBe(1);
});
it('selects parents, toggles additive selections and ignores nonexistent IDs', () => {
  const store = fixture();
  store.select('btn-next');
  store.select('absent');
  expect(store.getSnapshot().selection).toEqual(['btn-next']);
  store.select('home-root', true);
  store.select('home-root', true);
  expect(store.getSnapshot().selection).toEqual(['btn-next']);
  store.selectParent();
  expect(store.getSnapshot().selection).toEqual(['home-root']);
  store.selectParent();
  expect(store.getSnapshot().selection).toEqual([]);
  store.selectParent();
  expect(store.getSnapshot().selection).toEqual([]);
});
it('copies selected roots only and pastes fresh node IDs in one transaction', () => {
  const store = fixture();
  store.paste('home-root');
  expect(store.getSnapshot().history).toBe(0);
  store.insert('box', 'home-root');
  const box = store.getSnapshot().selection[0]!;
  store.move('btn-next', box);
  store.select(box);
  store.select('btn-next', true);
  expect(store.roots()).toEqual([box]);
  store.copy();
  store.paste('home-root');
  const pasted = store.getSnapshot().selection[0]!;
  expect(pasted).not.toBe(box);
  expect(store.node(pasted)?.children?.[0]?.id).not.toBe('btn-next');
  store.remove();
  expect(store.node(pasted)).toBeUndefined();
  store.undo();
  expect(store.node(pasted)).toBeDefined();
});
it('protects page roots, invalid groups and linked page creation', () => {
  const store = fixture();
  store.select('home-root');
  expect(() => {
    store.remove();
  }).toThrow('VERBIS_ROOT_IMMUTABLE');
  expect(() => {
    store.group();
  }).toThrow('VERBIS_SELECTION_PARENT');
  expect(() => {
    store.ungroup();
  }).toThrow('VERBIS_UNGROUP_INVALID');
  store.select('btn-next');
  expect(() => {
    store.ungroup();
  }).toThrow('VERBIS_UNGROUP_INVALID');
  const linked = new EditorStore(minimalScript(), new Set(['home']));
  expect(() => {
    linked.addPage('Cannot write');
  }).toThrow('VERBIS_READONLY');
  expect(() => {
    linked.insert('box', 'absent');
  }).toThrow('VERBIS_LINKED_READONLY');
});
it('caches lint by document identity, reports invalid expressions and publishes failures', () => {
  const store = fixture();
  const lint = store.issues();
  expect(store.issues()).toBe(lint);
  store.update('btn-next', (node) => {
    node.bindings.push({ prop: 'disabled', expression: 'vars.' });
  });
  expect(store.issues().some((issue) => issue.code === 'VERBIS_EXPRESSION')).toBe(true);
  expect(store.issues()).not.toBe(lint);
  store.execute(() => {
    throw new Error('synthetic');
  });
  expect(store.getSnapshot().message).toBe('designer.editor.operationFailed');
});
it('groups nested transactions and stops notifying unsubscribed listeners', () => {
  const store = fixture(),
    listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  store.batch(() => {
    store.batch(() => {
      store.insert('box', 'home-root');
    });
  });
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  store.setView({ breakpoint: 'md', zoom: 0.5 });
  expect(listener).toHaveBeenCalledOnce();
  store.edit(() => undefined);
  expect(store.getSnapshot().history).toBe(1);
});

it('keeps the active page valid when undo removes the newly created page', () => {
  const store = fixture();
  store.addPage('Synthetic page');
  const added = store.getSnapshot().pageId;
  expect(added).not.toBe('home');
  store.undo();
  expect(store.getSnapshot().pageId).toBe('home');
  expect(
    store.getSnapshot().document.pages.some((page) => page.id === store.getSnapshot().pageId),
  ).toBe(true);
  store.redo();
  expect(
    store.getSnapshot().document.pages.some((page) => page.id === store.getSnapshot().pageId),
  ).toBe(true);
});
