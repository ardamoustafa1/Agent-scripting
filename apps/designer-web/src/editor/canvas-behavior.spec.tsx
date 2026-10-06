import { act, fireEvent, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { Canvas } from './canvas.js';
import { HeatmapContext } from './heatmap.js';
import { EditorStore } from './store.js';

async function setup(selected = false) {
  const store = new EditorStore(minimalScript());
  if (selected) store.select('btn-next');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const child = this.closest('[data-editor-node]')?.getAttribute('data-editor-node');
    return new DOMRect(
      child === 'btn-next' ? 20 : 0,
      child === 'btn-next' ? 20 : 0,
      child === 'btn-next' ? 100 : 375,
      child === 'btn-next' ? 40 : 200,
    );
  });
  const f = await mountDesigner(
    <StrictMode>
      <Canvas store={store} />
    </StrictMode>,
  );
  return {
    ...f,
    store,
    host: document.querySelector('.ed-canvas')!,
    hover: document.querySelector<HTMLDivElement>('.ed-hover')!,
  };
}
it('hit tests nested nodes, renders hover bounds and ignores selection handles', async () => {
  const f = await setup();
  fireEvent.pointerMove(f.host, { clientX: 25, clientY: 25 });
  expect(f.hover.hidden).toBe(false);
  expect(f.hover.style.width).toBe('100px');
  fireEvent.pointerDown(f.host, { clientX: 25, clientY: 25 });
  expect(f.store.getSnapshot().selection).toEqual(['btn-next']);
  fireEvent.pointerMove(f.host, { clientX: 25, clientY: 25 });
  expect(f.hover.hidden).toBe(true);
  fireEvent.pointerMove(f.host, { clientX: 5, clientY: 5 });
  expect(f.hover.hidden).toBe(false);
  fireEvent.pointerLeave(f.host);
  expect(f.hover.hidden).toBe(true);
  fireEvent.pointerDown(document.querySelector('.ed-selection')!, { clientX: 5, clientY: 5 });
  expect(f.store.getSnapshot().selection).toEqual(['btn-next']);
  fireEvent.pointerDown(f.host, { clientX: 5, clientY: 5, shiftKey: true });
  expect(f.store.getSnapshot().selection).toContain('home-root');
  fireEvent.pointerMove(f.host, { clientX: 900, clientY: 900 });
  expect(f.hover.hidden).toBe(true);
});
it('resizes selected nodes by keyboard and pointer at the active breakpoint', async () => {
  const f = await setup(true);
  const resize = screen.getByRole('button', { name: f.label('editor.resize') });
  fireEvent.keyDown(resize, { key: 'ArrowLeft' });
  expect(f.store.node('btn-next')!.style?.base?.width).toBe('1/2');
  fireEvent.keyDown(resize, { key: 'ArrowRight' });
  expect(f.store.node('btn-next')!.style?.base?.width).toBe('full');
  fireEvent.keyDown(resize, { key: 'Escape' });
  act(() => {
    f.store.setView({ breakpoint: 'md' });
  });
  fireEvent.pointerDown(resize, { clientX: 20, pointerId: 1 });
  fireEvent.pointerUp(resize, { clientX: 304, pointerId: 1 });
  expect(f.store.node('btn-next')!.style?.md?.width).toBe('1/2');
  expect(f.store.node('btn-next')!.style?.base?.width).toBe('full');
});
it('cycles spacing tokens, handles drags and suppresses their following click', async () => {
  const f = await setup(true);
  const padding = screen.getByRole('button', { name: f.label('editor.styleLabels.padding') });
  fireEvent.click(padding);
  expect(f.store.node('btn-next')!.style?.base?.padding).toBe('xs');
  fireEvent.pointerDown(padding, { clientX: 10, pointerId: 1 });
  fireEvent.pointerUp(padding, { clientX: 42, pointerId: 1 });
  expect(f.store.node('btn-next')!.style?.base?.padding).toBe('lg');
  fireEvent.click(padding);
  expect(f.store.node('btn-next')!.style?.base?.padding).toBe('lg');
  fireEvent.click(padding);
  expect(f.store.node('btn-next')!.style?.base?.padding).toBe('xl');
  fireEvent.pointerDown(padding, { clientX: 10, pointerId: 1 });
  fireEvent.pointerUp(padding, { clientX: 12, pointerId: 1 });
  expect(f.store.node('btn-next')!.style?.base?.padding).toBe('xl');
  const gap = screen.getByRole('button', { name: f.label('editor.styleLabels.gap') });
  fireEvent.click(gap);
  expect(f.store.node('btn-next')!.style?.base?.gap).toBe('xs');
});
it('decorates component heat samples without changing the editor document', async () => {
  const store = new EditorStore(minimalScript());
  const before = store.getSnapshot().document;
  const f = await mountDesigner(
    <HeatmapContext.Provider
      value={[
        {
          versionId: 'v1',
          pageId: 'home',
          nodeId: 'btn-next',
          samples: 5,
          meanDwellMs: 2000,
          errors: 1,
        },
      ]}
    >
      <Canvas store={store} />
    </HeatmapContext.Provider>,
  );
  const label = document.querySelector('.ed-heat-label')!;
  expect(label.getAttribute('data-error')).toBe('true');
  expect(label.textContent).toBe(
    f.i18n.t('analytics.heatSample', { seconds: 2, errors: 1, samples: 5 }),
  );
  expect(store.getSnapshot().document).toBe(before);
});

it('fits the wide viewport inside available space without changing selection or document', async () => {
  const f = await setup(true);
  act(() => {
    f.store.setView({ breakpoint: 'xl' });
  });
  Object.defineProperty(f.host, 'clientWidth', { configurable: true, value: 600 });
  (f.host as HTMLElement).style.padding = '24px';
  const before = f.store.getSnapshot().document;
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.fitCanvas') }));
  expect(f.store.getSnapshot().zoom * 1280).toBeLessThanOrEqual(552);
  expect(f.store.getSnapshot().zoom).toBeGreaterThan(0.1);
  expect(f.store.getSnapshot().selection).toEqual(['btn-next']);
  expect(f.store.getSnapshot().document).toBe(before);
});

it('keeps the current page rendered after undo and redo', async () => {
  const f = await setup(true);
  const canvas = screen.getByRole('region', { name: f.label('editor.canvas') });
  expect(canvas.querySelector('[data-editor-node="btn-next"]')).not.toBeNull();
  act(() => {
    f.store.duplicate();
  });
  expect(canvas.querySelectorAll('[data-editor-node]')).toHaveLength(3);
  act(() => {
    f.store.undo();
  });
  expect(canvas.querySelector('[data-editor-node="btn-next"]')).not.toBeNull();
  expect(canvas.querySelectorAll('[data-editor-node]')).toHaveLength(2);
  act(() => {
    f.store.redo();
  });
  expect(canvas.querySelectorAll('[data-editor-node]')).toHaveLength(3);
});
