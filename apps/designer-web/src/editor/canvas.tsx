import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { memo, startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Runtime,
  ScriptRenderer,
  NodeDecorationContext,
  type NodeDecorationProps,
} from '@verbis/core-runtime';
import { walkNodes } from '@verbis/script-schema';
import { Alert, Button } from '@verbis/ui';

import { useNodeHeat } from './heatmap.js';
import { editorRegistry, useEditor, type EditorStore } from './store.js';
import { useSuggestionMark } from './suggest-marks.js';

function renderedChild(element: Element): Element | null {
  let child = element.firstElementChild;
  while (child && getComputedStyle(child).display === 'contents') child = child.firstElementChild;
  return child;
}
export function Frame({ node, children }: NodeDecorationProps) {
  const heat = useNodeHeat(node.id),
    suggested = useSuggestionMark(node.id),
    { t } = useTranslation();
  return (
    <div data-editor-node={node.id} style={{ display: 'contents' }}>
      {children}
      {suggested && (
        <span className="ed-suggest-mark" role="note">
          {t('designer.suggest.marked')}
        </span>
      )}
      {heat && (
        <span className="ed-heat-label" data-error={heat.errors > 0}>
          {t('analytics.heatSample', {
            seconds: Math.round((heat.meanDwellMs ?? 0) / 1000),
            errors: heat.errors,
            samples: heat.samples,
          })}
        </span>
      )}
    </div>
  );
}
// Drag context updates the canvas every pointer frame. The runtime document is
// unchanged during that drag, so keep its potentially large render tree stable.
const CanvasRuntime = memo(function CanvasRuntime({ runtime }: { runtime: Runtime }) {
  return (
    <NodeDecorationContext.Provider value={Frame}>
      <ScriptRenderer runtime={runtime} autoStart={false} />
    </NodeDecorationContext.Provider>
  );
});
/**
 * P-16: rebuilding the preview runtime re-renders every node. Structural edits (drop, delete,
 * undo) reach the canvas at once; typing in a field marked `data-coalesce-edits` (the inspector)
 * is coalesced and applied once the author pauses, as a low-priority transition.
 */
export const CANVAS_BURST_MS = 200;
let hostGeneration = 0;
const hostKeys = new WeakMap<Runtime, number>();
/** A new inert host per rendered preview runtime (not per store revision). */
function hostKeyOf(preview: Runtime | null): number {
  if (!preview) return 0;
  let key = hostKeys.get(preview);
  if (key === undefined) {
    key = ++hostGeneration;
    hostKeys.set(preview, key);
  }
  return key;
}
const typingInCoalescedField = () =>
  Boolean(document.activeElement?.closest('[data-coalesce-edits]'));
export function useCoalesced<T>(
  value: T,
  windowMs: number,
  coalesce: () => boolean = typingInCoalescedField,
): T {
  const [shown, setShown] = useState(value),
    changed = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const now = performance.now(),
      quiet = now - changed.current >= windowMs;
    changed.current = now;
    if (quiet || !coalesce()) {
      setShown(() => value);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(() => {
        setShown(() => value);
      });
    }, windowMs);
    return () => {
      clearTimeout(timer);
    };
    // `shown` is intentionally not a dependency: applying a value must not restart the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, windowMs]);
  return shown;
}
export function Canvas({ store, heatControl }: { store: EditorStore; heatControl?: ReactNode }) {
  const state = useEditor(store),
    { t } = useTranslation();
  const hover = useRef<HTMLDivElement>(null);
  const geometry = useRef<{ id: string; rect: DOMRect }[]>([]);
  const skipClick = useRef(false);
  const host = useRef<HTMLDivElement>(null),
    inert = useRef<HTMLDivElement>(null);
  const drop = useDroppable({ id: 'canvas' });
  const selected = state.selection[0];
  const drag = useDraggable({
    id: 'canvas-selection',
    data: { nodeId: selected },
    disabled: !selected,
  });
  const [bounds, setBounds] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // Document, page and breakpoint move together so a coalesced document never pairs with a page
  // it does not contain yet.
  const {
    document: docSource,
    pageId,
    breakpoint,
  } = useCoalesced(
    useMemo(
      () => ({ document: state.document, pageId: state.pageId, breakpoint: state.breakpoint }),
      [state.document, state.pageId, state.breakpoint],
    ),
    CANVAS_BURST_MS,
  );
  const preview = useMemo(() => {
    try {
      const runtime = new Runtime({
        document: (() => {
          const doc = structuredClone(docSource);
          const points = ['base', 'sm', 'md', 'lg', 'xl'];
          walkNodes(doc, ({ node }) => {
            const base = {};
            for (const point of points.slice(0, points.indexOf(breakpoint) + 1))
              Object.assign(base, node.style?.[point as typeof breakpoint]);
            node.style = { base };
            return true;
          });
          return doc;
        })(),
        registry: editorRegistry,
        ports: {
          sessionEvent: () => {
            /* Isolated preview deliberately emits no telemetry. */
          },
        },
        simulation: true,
      });
      runtime.store.set('runtime.page', pageId);
      return runtime;
    } catch {
      return null;
    }
  }, [docSource, pageId, breakpoint]);
  useEffect(
    () => () => {
      preview?.dispose();
    },
    [preview],
  );
  const hostKey = hostKeyOf(preview);
  useEffect(() => {
    const refresh = () => {
      const parent = host.current?.getBoundingClientRect();
      geometry.current = [...(inert.current?.querySelectorAll('[data-editor-node]') ?? [])].flatMap(
        (el) => {
          const id = el.getAttribute('data-editor-node'),
            child = renderedChild(el);
          return id && child ? [{ id, rect: child.getBoundingClientRect() }] : [];
        },
      );
      const element = selected
        ? (() => {
            const node = inert.current?.querySelector(
              `[data-editor-node="${CSS.escape(selected)}"]`,
            );
            return node ? renderedChild(node) : null;
          })()
        : null;
      const rect = element?.getBoundingClientRect();
      setBounds(
        parent && rect
          ? {
              left: rect.left - parent.left + (host.current?.scrollLeft ?? 0),
              top: rect.top - parent.top + (host.current?.scrollTop ?? 0),
              width: rect.width,
              height: rect.height,
            }
          : null,
      );
    };
    refresh();
    const element = host.current;
    const observer = new ResizeObserver(refresh);
    if (host.current) observer.observe(host.current);
    host.current?.addEventListener('scroll', refresh);
    return () => {
      observer.disconnect();
      element?.removeEventListener('scroll', refresh);
    };
    // Measure after the rendered (coalesced) document changes, not on every store revision:
    // reading every node's box forces layout and costs O(nodes) per keystroke (P-16).
  }, [selected, preview, state.zoom, state.breakpoint]);
  const width = { base: 375, sm: 640, md: 768, lg: 1024, xl: 1280 }[state.breakpoint];
  return (
    <section
      ref={drop.setNodeRef}
      className="ed-canvas-area"
      aria-label={t('designer.editor.canvas')}
    >
      <div className="ed-canvas-heading">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const canvas = host.current;
            if (!canvas) return;
            const css = getComputedStyle(canvas);
            const available =
              canvas.clientWidth -
              (parseFloat(css.paddingLeft) || 0) -
              (parseFloat(css.paddingRight) || 0);
            store.setView({
              zoom: Math.max(0.1, Math.min(2, Math.floor((available / width) * 100) / 100)),
            });
          }}
        >
          {t('designer.editor.fitCanvas')}
        </Button>
        {heatControl}
        {bounds && (
          <div className="ed-layout-handles">
            {(['gap', 'padding'] as const).map((key) => (
              <Button
                key={key}
                size="sm"
                variant="secondary"
                onPointerDown={(event) => {
                  const button = event.currentTarget,
                    start = event.clientX;
                  button.setPointerCapture(event.pointerId);
                  const finish = (end: PointerEvent) => {
                    button.removeEventListener('pointerup', finish);
                    if (Math.abs(end.clientX - start) < 4 || !selected) return;
                    skipClick.current = true;
                    const tokens = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
                    const index = Math.max(
                      0,
                      Math.min(tokens.length - 1, Math.round(Math.abs(end.clientX - start) / 8)),
                    );
                    store.execute(() => {
                      store.update(selected, (n) => {
                        n.style ??= {};
                        n.style[state.breakpoint] = {
                          ...n.style[state.breakpoint],
                          [key]: tokens[index],
                        };
                      });
                    });
                  };
                  button.addEventListener('pointerup', finish);
                }}
                onClick={() => {
                  if (skipClick.current) {
                    skipClick.current = false;
                    return;
                  }
                  if (!selected) return;
                  const tokens = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const;
                  store.execute(() => {
                    store.update(selected, (n) => {
                      n.style ??= {};
                      const old = n.style[state.breakpoint]?.[key] ?? 'none';
                      const index = tokens.indexOf(old as (typeof tokens)[number]);
                      n.style[state.breakpoint] = {
                        ...n.style[state.breakpoint],
                        [key]: tokens[(index + 1) % tokens.length],
                      };
                    });
                  });
                }}
              >
                {t(`designer.editor.styleLabels.${key}`)}
              </Button>
            ))}
          </div>
        )}
        <span>{state.document.pages.find((p) => p.id === state.pageId)?.name}</span>
        <span>
          {width} {t('designer.editor.by')} {t('designer.editor.auto')}
        </span>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Focusable canvas implements node selection and ordering commands. */}
      <div
        ref={host}
        id="editor-canvas"
        className="ed-canvas"
        // Native overflow scrolling needs a keyboard focus target even with no selected node.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="group"
        aria-label={t('designer.editor.canvas')}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
          )
            return;
          event.preventDefault();
          const ids: string[] = [];
          walkNodes(state.document, ({ node, pageId }) => {
            if (pageId === state.pageId) ids.push(node.id);
            return true;
          });
          const index = selected ? ids.indexOf(selected) : -1;
          if (event.altKey && selected && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            const location = store.location(selected);
            if (location?.parent)
              store.execute(() => {
                store.move(
                  selected,
                  location.parent?.id ?? '',
                  Math.max(0, (location.index ?? 0) + (event.key === 'ArrowDown' ? 1 : -1)),
                );
              });
          } else {
            const next =
              event.key === 'Home'
                ? ids[0]
                : event.key === 'End'
                  ? ids.at(-1)
                  : ids[
                      Math.max(
                        0,
                        Math.min(ids.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                      )
                    ];
            if (next) store.select(next);
          }
        }}
        onPointerLeave={() => {
          if (hover.current) hover.current.hidden = true;
        }}
        onPointerMove={(event) => {
          const hit = [...geometry.current]
            .reverse()
            .find(
              ({ rect }) =>
                event.clientX >= rect.left &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top &&
                event.clientY <= rect.bottom,
            );
          const parent = host.current?.getBoundingClientRect();
          if (hover.current) {
            hover.current.hidden = !hit || hit.id === selected;
            if (hit && parent) {
              hover.current.style.left = `${hit.rect.left - parent.left + (host.current?.scrollLeft ?? 0)}px`;
              hover.current.style.top = `${hit.rect.top - parent.top + (host.current?.scrollTop ?? 0)}px`;
              hover.current.style.width = `${hit.rect.width}px`;
              hover.current.style.height = `${hit.rect.height}px`;
            }
          }
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[data-editor-handle]')) return;
          const candidates = [
            ...(inert.current?.querySelectorAll('[data-editor-node]') ?? []),
          ].reverse();
          for (const candidate of candidates) {
            const rect = renderedChild(candidate)?.getBoundingClientRect();
            if (
              rect &&
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            ) {
              const id = candidate.getAttribute('data-editor-node');
              if (id) store.select(id, event.shiftKey);
              break;
            }
          }
        }}
      >
        <div
          className="ed-paper"
          style={{ width, transform: `scale(${state.zoom})`, transformOrigin: 'top left' }}
        >
          {/* Recreate the inert host on document edits: Chromium can retain zero
              layout boxes when descendants are replaced after undo or deletion.
              Selection, zoom and pointer frames keep the same host. Keyed by the rendered
              (coalesced) document, not every store revision: remounting all nodes per
              keystroke made inspector typing O(nodes) (P-16). */}
          <div key={hostKey} ref={inert} className="ed-runtime" {...{ inert: '' }}>
            {preview ? (
              <CanvasRuntime runtime={preview} />
            ) : (
              <Alert tone="warning" title={t('designer.editor.previewInvalid')} />
            )}
          </div>
        </div>
        <div ref={hover} hidden className="ed-hover" aria-hidden />
        {bounds && (
          <div className="ed-selection" style={bounds} data-editor-handle>
            <button
              ref={drag.setNodeRef}
              {...drag.listeners}
              {...drag.attributes}
              className="ed-selection-label"
            >
              {store.node(selected ?? '')?.type} <GripVertical size={14} aria-hidden />
            </button>
            <button
              className="ed-resize"
              aria-label={t('designer.editor.resize')}
              onKeyDown={(event) => {
                if (selected && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                  event.preventDefault();
                  store.execute(() => {
                    store.update(selected, (n) => {
                      n.style ??= {};
                      n.style[state.breakpoint] = {
                        ...n.style[state.breakpoint],
                        width: event.key === 'ArrowRight' ? 'full' : '1/2',
                      };
                    });
                  });
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                const button = event.currentTarget,
                  start = event.clientX;
                button.setPointerCapture(event.pointerId);
                const finish = (end: PointerEvent) => {
                  button.removeEventListener('pointerup', finish);
                  if (selected)
                    store.execute(() => {
                      store.update(selected, (n) => {
                        n.style ??= {};
                        n.style[state.breakpoint] = {
                          ...n.style[state.breakpoint],
                          width: (() => {
                            const fractions = [
                              ['1/4', 0.25],
                              ['1/3', 1 / 3],
                              ['1/2', 0.5],
                              ['2/3', 2 / 3],
                              ['3/4', 0.75],
                              ['full', 1],
                            ] as const;
                            const ratio =
                              (bounds.width + end.clientX - start) / (width * state.zoom);
                            return (
                              [...fractions].sort(
                                (a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio),
                              )[0]?.[0] ?? 'full'
                            );
                          })(),
                        };
                      });
                    });
                };
                button.addEventListener('pointerup', finish);
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
