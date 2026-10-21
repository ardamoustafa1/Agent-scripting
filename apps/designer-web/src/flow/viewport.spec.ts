import { describe, expect, it } from 'vitest';

import { openingViewport, READABLE_ZOOM } from './viewport.js';

const pane = { width: 1000, height: 600 };

describe('flow opening viewport', () => {
  it('shows a small graph whole and centred, never above 100 %', () => {
    const view = openingViewport(
      { x: 0, y: 0, width: 300, height: 200 },
      { x: 0, y: 0, width: 190, height: 60 },
      pane.width,
      pane.height,
    );
    expect(view.zoom).toBe(1);
    expect(view).toMatchObject({ x: 350, y: 200 });
  });
  it('fits a medium graph whole while names stay readable', () => {
    const view = openingViewport(
      { x: 0, y: 0, width: 1000, height: 600 },
      undefined,
      pane.width,
      pane.height,
    );
    expect(view.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(view.zoom).toBeLessThan(1);
    // Centred: the graph middle lands on the pane middle.
    expect(view.x + 500 * view.zoom).toBeCloseTo(500);
    expect(view.y + 300 * view.zoom).toBeCloseTo(300);
  });
  it('opens a tall graph at the readable zoom with the start step at the top', () => {
    // A 7-page template is about 1 000 px tall: fitting it whole would need zoom ≈ 0.42.
    const start = { x: 200, y: 40, width: 190, height: 60 };
    const view = openingViewport(
      { x: -300, y: 40, width: 900, height: 1100 },
      start,
      pane.width,
      pane.height,
    );
    expect(view.zoom).toBe(READABLE_ZOOM);
    // The start step sits horizontally centred, 48 px below the top edge.
    expect(view.x + (start.x + start.width / 2) * view.zoom).toBeCloseTo(500);
    expect(view.y + start.y * view.zoom).toBeCloseTo(48);
  });
  it('anchors on the graph when the start step is unknown', () => {
    const view = openingViewport(
      { x: 0, y: 100, width: 400, height: 3000 },
      undefined,
      pane.width,
      pane.height,
    );
    expect(view.zoom).toBe(READABLE_ZOOM);
    expect(view.y + 100 * view.zoom).toBeCloseTo(48);
  });
});
