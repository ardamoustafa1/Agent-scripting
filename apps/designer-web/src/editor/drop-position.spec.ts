import { describe, expect, it } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { resolveDrop, type NodeRects } from './drop-position.js';
import { EditorStore } from './store.js';

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/** Root box (0..400) containing a vertical stack: a(0..40) b(50..90) c(100..140). */
function stack() {
  const doc = minimalScript();
  const root = doc.pages[0]!.layout;
  root.children = [
    { id: 'a', type: 'text', props: {} },
    { id: 'b', type: 'text', props: {} },
    { id: 'c', type: 'text', props: {} },
  ];
  const rects: NodeRects = new Map([
    [root.id, rect(0, 0, 400, 400)],
    ['a', rect(0, 0, 400, 40)],
    ['b', rect(0, 50, 400, 40)],
    ['c', rect(0, 100, 400, 40)],
  ]);
  return { store: new EditorStore(doc), rects, rootId: root.id };
}

describe('resolveDrop (D-04 insert between siblings)', () => {
  it('inserts before a leaf when the pointer is over its upper half', () => {
    const { store, rects, rootId } = stack();
    expect(resolveDrop(store, 'text', undefined, { x: 10, y: 60 }, rects)).toEqual({
      parent: rootId,
      index: 1,
      line: { x: 0, y: 45, length: 400, axis: 'horizontal' },
    });
  });
  it('inserts after a leaf when the pointer is over its lower half', () => {
    const { store, rects, rootId } = stack();
    expect(resolveDrop(store, 'text', undefined, { x: 10, y: 85 }, rects)).toMatchObject({
      parent: rootId,
      index: 2,
    });
  });
  it('appends when dropping on the free area of the container below the last child', () => {
    const { store, rects, rootId } = stack();
    expect(resolveDrop(store, 'text', undefined, { x: 10, y: 300 }, rects)).toMatchObject({
      parent: rootId,
      index: 3,
    });
  });
  it('inserts into the gap between two children of the container', () => {
    const { store, rects, rootId } = stack();
    expect(resolveDrop(store, 'text', undefined, { x: 10, y: 95 }, rects)).toMatchObject({
      parent: rootId,
      index: 2,
    });
  });
  it('uses the horizontal axis for children laid out in a row', () => {
    const doc = minimalScript();
    const root = doc.pages[0]!.layout;
    root.children = [
      { id: 'a', type: 'text', props: {} },
      { id: 'b', type: 'text', props: {} },
    ];
    const rects: NodeRects = new Map([
      [root.id, rect(0, 0, 400, 40)],
      ['a', rect(0, 0, 190, 40)],
      ['b', rect(200, 0, 190, 40)],
    ]);
    const store = new EditorStore(doc);
    expect(resolveDrop(store, 'text', undefined, { x: 250, y: 20 }, rects)).toMatchObject({
      parent: root.id,
      index: 1,
      line: { axis: 'vertical' },
    });
    expect(resolveDrop(store, 'text', undefined, { x: 350, y: 20 }, rects)).toMatchObject({
      index: 2,
    });
  });
  it('drops into a nested container at the position among its own children', () => {
    const doc = minimalScript();
    const root = doc.pages[0]!.layout;
    root.children = [
      {
        id: 'inner',
        type: 'box',
        props: {},
        children: [
          { id: 'x', type: 'text', props: {} },
          { id: 'y', type: 'text', props: {} },
        ],
      },
    ];
    const rects: NodeRects = new Map([
      [root.id, rect(0, 0, 400, 400)],
      ['inner', rect(0, 0, 400, 100)],
      ['x', rect(0, 0, 400, 40)],
      ['y', rect(0, 50, 400, 40)],
    ]);
    const store = new EditorStore(doc);
    expect(resolveDrop(store, 'text', undefined, { x: 5, y: 10 }, rects)).toMatchObject({
      parent: 'inner',
      index: 0,
    });
  });
  it('returns null outside every node, and rejects moving a node into itself', () => {
    const { store, rects } = stack();
    expect(resolveDrop(store, 'text', undefined, { x: 900, y: 900 }, rects)).toBeNull();
    expect(resolveDrop(store, 'box', 'home-root', { x: 10, y: 10 }, rects)).toBeNull();
  });
});
