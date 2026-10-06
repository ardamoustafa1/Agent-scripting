import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CANVAS_BURST_MS, useCoalesced } from './canvas.js';

function Probe({ value, typing = true }: { value: string; typing?: boolean }) {
  return <output>{useCoalesced(value, CANVAS_BURST_MS, () => typing)}</output>;
}
afterEach(() => {
  vi.useRealTimers();
});
// P-16: a single edit (drop, delete, undo) reaches the canvas at once; typing bursts coalesce.
it('applies an isolated change immediately and a burst once the author pauses', () => {
  vi.useFakeTimers();
  const view = render(<Probe value="a" />);
  act(() => {
    vi.advanceTimersByTime(CANVAS_BURST_MS);
  });
  view.rerender(<Probe value="b" />);
  expect(screen.getByRole('status').textContent).toBe('b');
  for (const value of ['bc', 'bcd', 'bcde']) {
    act(() => {
      vi.advanceTimersByTime(CANVAS_BURST_MS / 4);
    });
    view.rerender(<Probe value={value} />);
    expect(screen.getByRole('status').textContent).toBe('b');
  }
  act(() => {
    vi.advanceTimersByTime(CANVAS_BURST_MS);
  });
  expect(screen.getByRole('status').textContent).toBe('bcde');
});
it('never delays structural edits made outside a coalesced field', () => {
  vi.useFakeTimers();
  const view = render(<Probe value="a" typing={false} />);
  for (const value of ['b', 'c', 'd']) {
    act(() => {
      vi.advanceTimersByTime(10);
    });
    view.rerender(<Probe value={value} typing={false} />);
    expect(screen.getByRole('status').textContent).toBe(value);
  }
});
