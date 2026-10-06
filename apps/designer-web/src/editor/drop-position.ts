import type { EditorStore } from './store.js';

/** D-04: pointer geometry → (parent, sibling index) so drops insert between siblings. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Rendered boxes by node id, in document (DOM) order so later entries are deeper. */
export type NodeRects = ReadonlyMap<string, Box>;
export interface InsertionLine {
  x: number;
  y: number;
  length: number;
  axis: 'horizontal' | 'vertical';
}
export interface DropPosition {
  parent: string;
  index: number;
  line: InsertionLine | undefined;
}

const inside = (box: Box, x: number, y: number) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

export function resolveDrop(
  store: EditorStore,
  type: string,
  movingId: string | undefined,
  pointer: { x: number; y: number },
  rects: NodeRects,
): DropPosition | null {
  const hit = [...rects.entries()].reverse().find(([, box]) => inside(box, pointer.x, pointer.y));
  if (!hit) return null;
  let current = hit[0],
    child: string | undefined;
  while (!store.canDrop(current, type, movingId)) {
    const parent = store.location(current)?.parent?.id;
    if (!parent) return null;
    child = current;
    current = parent;
  }
  const siblings = store.node(current)?.children ?? [];
  const boxes = siblings.map((node) => rects.get(node.id));
  const measured = boxes.filter((box): box is Box => !!box);
  const [first, second] = measured;
  const row = !!first && !!second && first.top < second.bottom && second.top < first.bottom;
  const axis = row ? 'vertical' : 'horizontal';
  const before = (box: Box, x: number, y: number) =>
    row ? x < (box.left + box.right) / 2 : y < (box.top + box.bottom) / 2;
  let index: number;
  if (child !== undefined) {
    const at = siblings.findIndex((node) => node.id === child);
    const box = rects.get(child);
    index = at + (box && !before(box, pointer.x, pointer.y) ? 1 : 0);
  } else {
    const at = boxes.findIndex((box) => !!box && before(box, pointer.x, pointer.y));
    index = at === -1 ? siblings.length : at;
  }
  return { parent: current, index, line: line(boxes, index, row, axis) };
}
function line(
  boxes: readonly (Box | undefined)[],
  index: number,
  row: boolean,
  axis: InsertionLine['axis'],
): InsertionLine | undefined {
  const next = boxes[index],
    prev = boxes[index - 1];
  const anchor = next ?? prev;
  if (!anchor) return undefined;
  const edge = (box: Box, side: 'start' | 'end') =>
    row ? (side === 'start' ? box.left : box.right) : side === 'start' ? box.top : box.bottom;
  const position =
    next && prev
      ? (edge(prev, 'end') + edge(next, 'start')) / 2
      : next
        ? edge(next, 'start')
        : edge(anchor, 'end');
  return row
    ? { axis, x: position, y: anchor.top, length: anchor.bottom - anchor.top }
    : { axis, x: anchor.left, y: position, length: anchor.right - anchor.left };
}
