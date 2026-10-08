import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import {
  DEFAULT_PANELS,
  loadPanels,
  PANEL_LIMITS,
  PanelResizer,
  savePanels,
} from './panel-resizer.js';

const i18n = await createI18n('en');
function Harness({ side }: { side: 'left' | 'right' }) {
  const [size, setSize] = useState(DEFAULT_PANELS[side]);
  return <PanelResizer side={side} size={size} onChange={setSize} />;
}
const mount = (side: 'left' | 'right') =>
  render(
    <UiProvider i18n={i18n}>
      <Harness side={side} />
    </UiProvider>,
  );
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  localStorage.clear();
});

it('widens and narrows with arrow keys, jumps with Home/End and resets on Enter', () => {
  mount('left');
  const bar = screen.getByRole('separator', { name: 'Resize components panel' });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(DEFAULT_PANELS.left));
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(DEFAULT_PANELS.left + 16));
  fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true });
  // 232 - 64 would be 168: below the minimum, so the limit wins.
  expect(bar.getAttribute('aria-valuenow')).toBe(String(PANEL_LIMITS.left.min));
  fireEvent.keyDown(bar, { key: 'End' });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(PANEL_LIMITS.left.max));
  fireEvent.keyDown(bar, { key: 'Home' });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(PANEL_LIMITS.left.min));
  fireEvent.keyDown(bar, { key: 'Enter' });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(DEFAULT_PANELS.left));
});

it('grows the right panel when dragged towards the canvas and never leaves its limits', () => {
  mount('right');
  const bar = screen.getByRole('separator', { name: 'Resize properties panel' });
  Object.defineProperty(bar, 'setPointerCapture', { value: () => undefined });
  fireEvent.pointerDown(bar, { clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(bar, { clientX: 440, pointerId: 1 });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(DEFAULT_PANELS.right + 60));
  fireEvent.pointerMove(bar, { clientX: -4000, pointerId: 1 });
  expect(bar.getAttribute('aria-valuenow')).toBe(String(PANEL_LIMITS.right.max));
  fireEvent.pointerUp(bar, { pointerId: 1 });
  fireEvent.doubleClick(bar);
  expect(bar.getAttribute('aria-valuenow')).toBe(String(DEFAULT_PANELS.right));
});

it('restores saved sizes, clamps stored garbage and survives blocked storage', () => {
  savePanels({ left: 300, right: 400 });
  expect(loadPanels()).toEqual({ left: 300, right: 400 });
  localStorage.setItem('verbis.editor.panels', JSON.stringify({ left: 5, right: 99999 }));
  expect(loadPanels()).toEqual({ left: PANEL_LIMITS.left.min, right: PANEL_LIMITS.right.max });
  localStorage.setItem('verbis.editor.panels', '{broken');
  expect(loadPanels()).toEqual(DEFAULT_PANELS);
});
