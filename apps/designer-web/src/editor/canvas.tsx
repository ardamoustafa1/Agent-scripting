import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

function renderedChild(element: Element): Element | null {
  let child = element.firstElementChild;
  while (child && getComputedStyle(child).display === 'contents') child = child.firstElementChild;
  return child;
}
export function Frame({ node, children }: NodeDecorationProps) {
  const heat = useNodeHeat(node.id),
    { t } = useTranslation();
  return (
    <div data-editor-node={node.id} style={{ display: 'contents' }}>
      {children}
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
  const { document: docSource, pageId, breakpoint } = state;
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
  }, [selected, state.revision, state.zoom, state.breakpoint]);
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
      <div
        ref={host}
        className="ed-canvas"
        // Native overflow scrolling needs a keyboard focus target even with no selected node.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="group"
        aria-label={t('designer.editor.canvas')}
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
              Selection, zoom and pointer frames keep the same host. */}
          <div key={state.revision} ref={inert} className="ed-runtime" {...{ inert: '' }}>
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
