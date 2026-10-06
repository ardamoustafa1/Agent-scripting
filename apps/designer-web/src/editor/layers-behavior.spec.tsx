import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { editorFixture } from './fixtures.js';
import { LeftPanel } from './layers.js';
import { EditorStore } from './store.js';

async function setup() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  const store = new EditorStore(editorFixture(2).document);
  const f = await mountDesigner(<LeftPanel store={store} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.layers') }), { button: 0 });
  const button = async (id: string) => {
    const row = await waitFor(() => {
      const value = document.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
      expect(value).toBeTruthy();
      return value!;
    });
    return row.lastElementChild as HTMLButtonElement;
  };
  return { ...f, store, button };
}
it('selects, navigates and collapses layers with the keyboard', async () => {
  const f = await setup();
  const root = await f.button('home-root');
  fireEvent.click(root);
  expect(f.store.getSnapshot().selection).toEqual(['home-root']);
  fireEvent.keyDown(root, { key: 'ArrowDown' });
  expect(f.store.getSnapshot().selection).toEqual(['btn-next']);
  const child = await f.button('btn-next');
  fireEvent.keyDown(child, { key: 'ArrowUp' });
  expect(f.store.getSnapshot().selection).toEqual(['home-root']);
  fireEvent.keyDown(root, { key: 'ArrowLeft' });
  expect(document.querySelector('[data-layer-id="btn-next"]')).toBeNull();
  fireEvent.keyDown(root, { key: 'ArrowRight' });
  expect(await f.button('btn-next')).toBeTruthy();
  fireEvent.click(await f.button('btn-next'));
  fireEvent.keyDown(await f.button('btn-next'), { key: 'Escape' });
  expect(f.store.getSnapshot().selection).toEqual(['home-root']);
  fireEvent.click(await f.button('btn-next'));
  fireEvent.keyDown(await f.button('btn-next'), { key: 'ArrowLeft' });
  expect(f.store.getSnapshot().selection).toEqual(['home-root']);
});
it('reorders siblings with Alt and supports additive selection and collapse controls', async () => {
  const f = await setup();
  fireEvent.keyDown(await f.button('fixture-0'), { key: 'ArrowUp', altKey: true });
  expect(f.store.getSnapshot().document.pages[0]!.layout.children!.map((n) => n['id'])).toEqual([
    'fixture-0',
    'btn-next',
  ]);
  fireEvent.keyDown(await f.button('fixture-0'), { key: 'ArrowDown', altKey: true });
  expect(f.store.getSnapshot().document.pages[0]!.layout.children!.map((n) => n['id'])).toEqual([
    'btn-next',
    'fixture-0',
  ]);
  fireEvent.click(await f.button('btn-next'));
  fireEvent.click(await f.button('fixture-0'), { shiftKey: true });
  expect(f.store.getSnapshot().selection).toEqual(['btn-next', 'fixture-0']);
  fireEvent.click(
    within(document.querySelector<HTMLElement>('[data-layer-id="home-root"]')!).getAllByRole(
      'button',
      { name: 'home-root' },
    )[1]!,
  );
  expect(document.querySelector('[data-layer-id="fixture-0"]')).toBeNull();
});
it('inserts palette components into a selected leaf’s allowed ancestor', async () => {
  const f = await setup();
  act(() => {
    f.store.select('btn-next');
  });
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.components') }), {
    button: 0,
  });
  fireEvent.change(screen.getByLabelText(f.label('editor.search')), {
    target: { value: f.label('editor.componentNames.textInput') },
  });
  const insert = screen
    .getAllByRole('button', { name: f.label('editor.componentNames.textInput') })
    .find((node) => node.classList.contains('vb-button'))!;
  fireEvent.click(insert);
  expect(f.store.getSnapshot().document.pages[0]!.layout.children).toHaveLength(3);
  expect(f.store.getSnapshot().document.pages[0]!.layout.children!.at(-1)).toMatchObject({
    type: 'textInput',
  });
});

it('finds a component on another page and jumps to it without editing the document', async () => {
  const doc = editorFixture().document;
  const second = structuredClone(doc.pages[0]!);
  second.id = 'second';
  second.name = 'Second page';
  second.layout.id = 'second-root';
  second.layout.children![0]!['id'] = 'target-button';
  doc.pages.push(second);
  const store = new EditorStore(doc);
  const f = await mountDesigner(<LeftPanel store={store} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.layers') }), { button: 0 });
  const before = store.getSnapshot().document;
  fireEvent.change(screen.getByLabelText(f.label('editor.findNode')), {
    target: { value: 'target-button' },
  });
  fireEvent.click(screen.getByRole('button', { name: /target-button/ }));
  expect(store.getSnapshot().pageId).toBe('second');
  expect(store.getSnapshot().selection).toEqual(['target-button']);
  expect(store.getSnapshot().document).toBe(before);
  fireEvent.change(screen.getByLabelText(f.label('editor.findNode')), {
    target: { value: 'missing-node' },
  });
  expect(screen.getByText(f.label('editor.noMatchingNodes'))).toBeTruthy();
});
it('renames the selected page without changing its id or flow references and preserves linked pages', async () => {
  const store = new EditorStore(editorFixture().document);
  const f = await mountDesigner(<LeftPanel store={store} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.pages') }), { button: 0 });
  const flow = store.getSnapshot().document.flow;
  fireEvent.change(screen.getByLabelText(f.label('editor.pageName')), {
    target: { value: 'Delivery welcome' },
  });
  expect(store.getSnapshot().document.pages[0]).toMatchObject({
    id: 'home',
    name: 'Delivery welcome',
  });
  expect(store.getSnapshot().document.flow).toBe(flow);
  act(() => {
    store.undo();
  });
  expect(store.getSnapshot().document.pages[0]?.name).toBe(editorFixture().document.pages[0]?.name);
  f.ui.unmount();
  await mountDesigner(
    <LeftPanel store={new EditorStore(editorFixture().document, new Set(['home']))} />,
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.pages') }), { button: 0 });
  expect(screen.getByLabelText<HTMLInputElement>(f.label('editor.pageName')).disabled).toBe(true);
});

it('finds displayed localized content and tolerates Turkish accents without searching unrelated messages', async () => {
  const doc = editorFixture().document;
  doc.pages[0]!.layout.children![0]!['props'] = { labelKey: 'delivery.help' };
  doc.i18n.messages['en']!['delivery.help'] = 'Kargo desteği';
  doc.i18n.messages['en']!['unused.help'] = 'Unrelated secret wording';
  const store = new EditorStore(doc);
  const f = await mountDesigner(<LeftPanel store={store} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.layers') }), { button: 0 });
  fireEvent.change(screen.getByLabelText(f.label('editor.findNode')), {
    target: { value: ' KARGO DESTEGI ' },
  });
  expect(screen.getByRole('button', { name: /btn-next/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('editor.findNode')), {
    target: { value: 'unrelated secret' },
  });
  expect(screen.getByText(f.label('editor.noMatchingNodes'))).toBeTruthy();
});
it('filters page names and ids without changing the selected page or document', async () => {
  const doc = editorFixture().document;
  const second = structuredClone(doc.pages[0]!);
  second.id = 'delivery';
  second.name = 'Kargo desteği';
  second.layout.id = 'delivery-root';
  second.layout.children![0]!['id'] = 'delivery-next';
  doc.pages.push(second);
  const store = new EditorStore(doc);
  const f = await mountDesigner(<LeftPanel store={store} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.pages') }), { button: 0 });
  const before = store.getSnapshot().document;
  fireEvent.change(screen.getByLabelText(f.label('editor.findPage')), {
    target: { value: 'kargo destegi' },
  });
  expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
  expect(store.getSnapshot().pageId).toBe('home');
  fireEvent.click(screen.getByRole('button', { name: second.name }));
  expect(store.getSnapshot().pageId).toBe('delivery');
  expect(store.getSnapshot().document).toBe(before);
  fireEvent.change(screen.getByLabelText(f.label('editor.findPage')), {
    target: { value: 'missing-page' },
  });
  expect(screen.getByText(f.label('editor.noMatchingPages'))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('editor.findPage')), { target: { value: '  ' } });
  expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
});

it('bounds large search result lists and keeps later matches reachable without editing', async () => {
  const store = new EditorStore(editorFixture(1000).document);
  const f = await mountDesigner(<LeftPanel store={store} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('editor.layers') }), { button: 0 });
  const before = store.getSnapshot().document;
  fireEvent.change(screen.getByLabelText(f.label('editor.findNode')), { target: { value: 'box' } });
  const results = screen.getByRole('region', { name: f.label('editor.nodeResults') });
  expect(within(results).getAllByRole('button').length).toBeLessThan(60);
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.nextResults') }));
  expect(within(results).queryByRole('button', { name: /home-root/ })).toBeNull();
  fireEvent.click(within(results).getByRole('button', { name: /fixture-49/ }));
  expect(store.getSnapshot().selection).toEqual(['fixture-49']);
  expect(store.getSnapshot().document).toBe(before);
  fireEvent.change(screen.getByLabelText(f.label('editor.findNode')), {
    target: { value: 'btn-next' },
  });
  expect(within(results).getByRole('button', { name: /btn-next/ })).toBeTruthy();
});
