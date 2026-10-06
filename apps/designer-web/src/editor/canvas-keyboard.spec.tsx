import { DndContext } from '@dnd-kit/core';
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { Canvas } from './canvas.js';
import { EditorStore } from './store.js';

it('selects canvas nodes with Home/End/arrows and reorders siblings with Alt/arrows', async () => {
  const doc = minimalScript();
  doc.pages[0]!.layout.children!.push({ id: 'second', type: 'box', props: {} });
  const store = new EditorStore(doc);
  const f = await mountDesigner(
    <DndContext>
      <Canvas store={store} />
    </DndContext>,
  );
  const canvas = screen.getByRole('group', { name: f.label('editor.canvas') });
  fireEvent.keyDown(canvas, { key: 'ArrowDown' });
  expect(store.getSnapshot().selection).toEqual(['home-root']);
  fireEvent.keyDown(canvas, { key: 'ArrowUp', altKey: true });
  expect(store.getSnapshot().selection).toEqual(['home-root']);
  fireEvent.keyDown(canvas, { key: 'End' });
  expect(store.getSnapshot().selection).toEqual(['second']);
  fireEvent.keyDown(canvas, { key: 'ArrowUp' });
  expect(store.getSnapshot().selection).toEqual(['btn-next']);
  fireEvent.keyDown(canvas, { key: 'ArrowDown', altKey: true });
  expect(store.getSnapshot().document.pages[0]!.layout.children!.map((n) => n['id'])).toEqual([
    'second',
    'btn-next',
  ]);
  fireEvent.keyDown(canvas, { key: 'ArrowUp', altKey: true });
  expect(store.getSnapshot().document.pages[0]!.layout.children!.map((n) => n['id'])).toEqual([
    'btn-next',
    'second',
  ]);
  fireEvent.keyDown(canvas, { key: 'Home' });
  expect(store.getSnapshot().selection).toEqual(['home-root']);
  fireEvent.keyDown(canvas, { key: 'Tab' });
  expect(store.getSnapshot().selection).toEqual(['home-root']);
  const input = document.createElement('input');
  canvas.append(input);
  fireEvent.keyDown(input, { key: 'End' });
  expect(store.getSnapshot().selection).toEqual(['home-root']);
  act(() => {
    store.setWriteSuspended(true);
  });
  fireEvent.keyDown(canvas, { key: 'End' });
  fireEvent.keyDown(canvas, { key: 'ArrowUp', altKey: true });
  expect(store.getSnapshot().document.pages[0]!.layout.children!.map((n) => n['id'])).toEqual([
    'btn-next',
    'second',
  ]);
});
