import { useDndMonitor } from '@dnd-kit/core';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveDrop, type NodeRects } from './drop-position.js';

import type { EditorStore } from './store.js';

interface Rect {
  id: string;
  rect: DOMRect;
}
/** Rendered node boxes in DOM order (parents before children). */
export function measureNodes(): NodeRects {
  const rects = new Map<string, DOMRect>();
  for (const el of document.querySelectorAll('[data-editor-node]')) {
    const id = el.getAttribute('data-editor-node'),
      child = el.firstElementChild;
    if (id && child) rects.set(id, child.getBoundingClientRect());
  }
  return rects;
}
/** Geometry is captured once per drag; pointer frames never traverse or patch the document. */
export function DropGuides({ store }: { store: EditorStore }) {
  const { t } = useTranslation(),
    guide = useRef<HTMLDivElement>(null),
    vertical = useRef<HTMLDivElement>(null),
    horizontal = useRef<HTMLDivElement>(null),
    insertion = useRef<HTMLDivElement>(null),
    geometry = useRef<Rect[]>([]),
    frame = useRef(0);
  const hide = () => {
    cancelAnimationFrame(frame.current);
    for (const ref of [guide, vertical, horizontal, insertion])
      if (ref.current) ref.current.hidden = true;
  };
  useDndMonitor({
    onDragStart() {
      geometry.current = [...document.querySelectorAll('[data-editor-node]')].flatMap((el) => {
        const id = el.getAttribute('data-editor-node'),
          child = el.firstElementChild;
        return id && child ? [{ id, rect: child.getBoundingClientRect() }] : [];
      });
    },
    onDragMove(event) {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        if (!(event.activatorEvent instanceof MouseEvent)) return;
        const x = event.activatorEvent.clientX + event.delta.x,
          y = event.activatorEvent.clientY + event.delta.y;
        const data = event.active.data.current as { type?: string; nodeId?: string } | undefined;
        const type = data?.type ?? (data?.nodeId ? store.node(data.nodeId)?.type : undefined);
        const place = type
          ? resolveDrop(
              store,
              type,
              data?.nodeId,
              { x, y },
              new Map(geometry.current.map((g) => [g.id, g.rect])),
            )
          : null;
        if (insertion.current) {
          const line = place?.line;
          insertion.current.hidden = !line;
          if (line) {
            const horizontalLine = line.axis === 'horizontal';
            insertion.current.dataset['axis'] = line.axis;
            insertion.current.style.left = `${line.x}px`;
            insertion.current.style.top = `${line.y}px`;
            insertion.current.style.width = horizontalLine ? `${line.length}px` : '';
            insertion.current.style.height = horizontalLine ? '' : `${line.length}px`;
          }
        }
        const hit = [...geometry.current]
          .reverse()
          .find(
            ({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
          );
        if (guide.current && hit) {
          let parent = hit.id;
          while (parent && type && !store.canDrop(parent, type, data?.nodeId))
            parent = store.location(parent)?.parent?.id ?? '';
          const candidate = geometry.current.find((g) => g.id === parent) ?? hit;
          guide.current.hidden = false;
          guide.current.dataset['valid'] = String(!!parent);
          guide.current.style.left = `${candidate.rect.left}px`;
          guide.current.style.top = `${candidate.rect.top}px`;
          guide.current.style.width = `${candidate.rect.width}px`;
          guide.current.style.height = `${candidate.rect.height}px`;
        } else if (guide.current) guide.current.hidden = true;
        const active = event.active.rect.current.translated;
        if (!active) return;
        const edgesX = [active.left, active.left + active.width / 2, active.right],
          edgesY = [active.top, active.top + active.height / 2, active.bottom];
        const snapX = geometry.current
          .flatMap((g) => [g.rect.left, g.rect.left + g.rect.width / 2, g.rect.right])
          .find((edge) => edgesX.some((x) => Math.abs(edge - x) < 4));
        const snapY = geometry.current
          .flatMap((g) => [g.rect.top, g.rect.top + g.rect.height / 2, g.rect.bottom])
          .find((edge) => edgesY.some((y) => Math.abs(edge - y) < 4));
        if (vertical.current) {
          vertical.current.hidden = snapX === undefined;
          if (snapX !== undefined) vertical.current.style.left = `${snapX}px`;
        }
        if (horizontal.current) {
          horizontal.current.hidden = snapY === undefined;
          if (snapY !== undefined) horizontal.current.style.top = `${snapY}px`;
        }
      });
    },
    onDragEnd: hide,
    onDragCancel: hide,
  });
  return (
    <>
      <div ref={guide} hidden className="ed-drop-target" aria-hidden>
        <span>{t('designer.editor.dropTarget')}</span>
      </div>
      <div ref={insertion} hidden className="ed-insertion-line" aria-hidden />
      <div ref={vertical} hidden className="ed-guide-vertical" aria-hidden />
      <div ref={horizontal} hidden className="ed-guide-horizontal" aria-hidden />
    </>
  );
}
