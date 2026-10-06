import {
  DndContext,
  MouseSensor,
  KeyboardSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { DropGuides } from './drop-guides.js';
import { EditorStore } from './store.js';

function Handle({ moving = false }: { moving?: boolean }) {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: 'synthetic-drag',
    data: moving ? { nodeId: 'home-root' } : { type: 'text' },
  });
  return (
    <button ref={setNodeRef} {...listeners} {...attributes}>
      Synthetic drag
    </button>
  );
}
function Harness({ store, moving = false }: { store: EditorStore; moving?: boolean }) {
  const sensors = useSensors(useSensor(MouseSensor), useSensor(KeyboardSensor));
  return (
    <DndContext sensors={sensors}>
      <Handle moving={moving} />
      <div data-editor-node="home-root">
        <div data-rect="root" />
      </div>
      <div data-editor-node="btn-next">
        <button data-rect="child" />
      </div>
      <DropGuides store={store} />
    </DndContext>
  );
}
async function setup(moving = false) {
  const store = new EditorStore(minimalScript());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset['rect'] === 'child') return new DOMRect(20, 20, 100, 40);
    return new DOMRect(0, 0, 375, 200);
  });
  const f = await mountDesigner(<Harness store={store} moving={moving} />);
  return { ...f, store, target: document.querySelector<HTMLDivElement>('.ed-drop-target')! };
}
it('finds a valid ancestor drop target while dragging and hides guides on completion', async () => {
  const f = await setup();
  const before = f.store.getSnapshot().document;
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Synthetic drag' }), {
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  fireEvent.mouseMove(document, { clientX: 25, clientY: 25 });
  await waitFor(() => {
    expect(f.target.hidden).toBe(false);
  });
  expect(f.target.dataset['valid']).toBe('true');
  expect(f.target.style.width).toBe('375px');
  expect(f.store.getSnapshot().document).toBe(before);
  fireEvent.mouseMove(document, { clientX: 900, clientY: 900 });
  await waitFor(() => {
    expect(f.target.hidden).toBe(true);
  });
  fireEvent.mouseUp(document);
  expect(document.querySelector<HTMLDivElement>('.ed-guide-vertical')!.hidden).toBe(true);
  expect(document.querySelector<HTMLDivElement>('.ed-guide-horizontal')!.hidden).toBe(true);
});
it('marks a self-descendant move invalid and cancels the drag', async () => {
  const f = await setup(true);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Synthetic drag' }), {
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  fireEvent.mouseMove(document, { clientX: 25, clientY: 25 });
  await waitFor(() => {
    expect(f.target.hidden).toBe(false);
  });
  expect(f.target.dataset['valid']).toBe('false');
  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  await waitFor(() => {
    expect(f.target.hidden).toBe(true);
  });
  expect(f.store.getSnapshot().history).toBe(0);
});
