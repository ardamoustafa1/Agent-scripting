export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
/** Below this zoom the 14 px step names render under 10 px and stop being readable. */
export const READABLE_ZOOM = 0.7;
/** Screen pixels kept free around the opened graph. */
const MARGIN = 48;

/**
 * Where a flow opens. The whole graph when it fits at a readable size (never above 100 %);
 * otherwise the start step at the top, centred, at the readable zoom, so step names stay legible
 * and the mini map and the fit control show the rest.
 */
export function openingViewport(
  graph: Rect,
  start: Rect | undefined,
  width: number,
  height: number,
): Viewport {
  const fit = Math.min(
    (width - 2 * MARGIN) / Math.max(graph.width, 1),
    (height - 2 * MARGIN) / Math.max(graph.height, 1),
    1,
  );
  if (fit >= READABLE_ZOOM)
    return {
      zoom: fit,
      x: width / 2 - (graph.x + graph.width / 2) * fit,
      y: height / 2 - (graph.y + graph.height / 2) * fit,
    };
  const anchor = start ?? graph;
  return {
    zoom: READABLE_ZOOM,
    x: width / 2 - (anchor.x + anchor.width / 2) * READABLE_ZOOM,
    y: MARGIN - anchor.y * READABLE_ZOOM,
  };
}
