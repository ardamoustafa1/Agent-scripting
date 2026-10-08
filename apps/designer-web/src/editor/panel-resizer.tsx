import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface PanelSize {
  left: number;
  right: number;
}
export const DEFAULT_PANELS: PanelSize = { left: 212, right: 252 };
export const PANEL_LIMITS = {
  left: { min: 180, max: 480 },
  right: { min: 220, max: 560 },
} as const;
const STORAGE_KEY = 'verbis.editor.panels';

const clamp = (value: number, side: 'left' | 'right') =>
  Math.min(PANEL_LIMITS[side].max, Math.max(PANEL_LIMITS[side].min, Math.round(value)));

export function loadPanels(): PanelSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANELS;
    const parsed = JSON.parse(raw) as Partial<PanelSize>;
    return {
      left: clamp(parsed.left ?? DEFAULT_PANELS.left, 'left'),
      right: clamp(parsed.right ?? DEFAULT_PANELS.right, 'right'),
    };
  } catch {
    return DEFAULT_PANELS;
  }
}
export function savePanels(size: PanelSize) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Storage can be blocked; the sizes then simply last for this visit.
  }
}

/** Draggable and keyboard-operable divider between a side panel and the canvas. */
export function PanelResizer({
  side,
  size,
  onChange,
}: {
  side: 'left' | 'right';
  size: number;
  onChange: (next: number) => void;
}) {
  const { t } = useTranslation();
  const start = useRef<{ x: number; size: number; sign: 1 | -1 } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { min, max } = PANEL_LIMITS[side];
  const label = t(side === 'left' ? 'designer.editor.resizeLeft' : 'designer.editor.resizeRight');
  const direction = (element: Element): 1 | -1 =>
    getComputedStyle(element).direction === 'rtl' ? -1 : 1;
  const grow = (element: Element): 1 | -1 =>
    ((side === 'left' ? 1 : -1) * direction(element)) as 1 | -1;
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, size, sign: grow(event.currentTarget) };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (origin) onChange(clamp(origin.size + (event.clientX - origin.x) * origin.sign, side));
  };
  const end = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const sign = grow(event.currentTarget);
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = size + step * sign;
    else if (event.key === 'ArrowLeft') next = size - step * sign;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key === 'Enter') next = DEFAULT_PANELS[side];
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next, side));
  };
  return (
    // A focusable separator is an interactive widget in WAI-ARIA (window splitter pattern).
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      aria-valuetext={t('designer.editor.panelWidth', { px: size })}
      tabIndex={0}
      className="ed-resizer"
      data-side={side}
      data-dragging={dragging}
      title={t('designer.editor.resizeHint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onChange(DEFAULT_PANELS[side]);
      }}
    />
    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  );
}
