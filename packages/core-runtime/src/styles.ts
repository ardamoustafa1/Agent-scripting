import { ResponsiveStyleSchema, type ResponsiveStyle } from '@verbis/script-schema';

import type { CSSProperties } from 'react';

const spacing: Record<string, string> = {
  none: '0',
  xs: 'var(--vb-space-1)',
  sm: 'var(--vb-space-2)',
  md: 'var(--vb-space-4)',
  lg: 'var(--vb-space-6)',
  xl: 'var(--vb-space-8)',
  '2xl': 'var(--vb-space-12)',
};
const sizes: Record<string, string> = {
  auto: 'auto',
  full: '100%',
  fit: 'fit-content',
  '1/4': '25%',
  '1/3': '33.333333%',
  '1/2': '50%',
  '2/3': '66.666667%',
  '3/4': '75%',
  xs: '16rem',
  sm: '24rem',
  md: '32rem',
  lg: '48rem',
  xl: '64rem',
};
const properties: Record<string, string> = {
  display: 'display',
  direction: 'flex-direction',
  wrap: 'flex-wrap',
  gap: 'gap',
  padding: 'padding',
  paddingInline: 'padding-inline',
  paddingBlock: 'padding-block',
  margin: 'margin',
  width: 'inline-size',
  minWidth: 'min-inline-size',
  maxWidth: 'max-inline-size',
  columns: 'grid-template-columns',
  colSpan: 'grid-column',
  grow: 'flex-grow',
  shrink: 'flex-shrink',
  align: 'align-items',
  justify: 'justify-content',
  textAlign: 'text-align',
  tone: 'color',
  emphasis: 'font-weight',
  scroll: 'overflow',
};
const initial: Record<string, string> = {
  display: 'flex',
  'flex-direction': 'column',
  'flex-wrap': 'nowrap',
  gap: '0',
  padding: '0',
  'padding-inline': '0',
  'padding-block': '0',
  margin: '0',
  'inline-size': 'auto',
  'min-inline-size': '0',
  'max-inline-size': 'none',
  'grid-template-columns': 'none',
  'grid-column': 'auto',
  'flex-grow': '0',
  'flex-shrink': '1',
  'align-items': 'stretch',
  'justify-content': 'start',
  'text-align': 'start',
  color: 'var(--vb-color-text)',
  'font-weight': '400',
  overflow: 'visible',
};
export function responsiveStyle(input: ResponsiveStyle = {}): CSSProperties {
  const parsed = ResponsiveStyleSchema.parse(input);
  const result: Record<string, string> = {};
  for (const [breakpoint, rules] of Object.entries(parsed)) {
    if (!rules) continue;
    for (const [key, value] of Object.entries(rules)) {
      if (value === undefined) continue;
      const property = properties[key];
      if (!property) continue;
      let css = String(value);
      if (['gap', 'padding', 'paddingInline', 'paddingBlock', 'margin'].includes(key))
        css = spacing[String(value)] ?? '0';
      if (['width', 'minWidth', 'maxWidth'].includes(key)) css = sizes[String(value)] ?? 'auto';
      if (key === 'columns') css = `repeat(${String(value)}, minmax(0, 1fr))`;
      if (key === 'colSpan') css = `span ${String(value)}`;
      if (key === 'wrap') css = value ? 'wrap' : 'nowrap';
      if (key === 'scroll') css = value ? 'auto' : 'visible';
      if (key === 'tone')
        css = value === 'neutral' ? 'var(--vb-color-text)' : `var(--vb-color-${String(value)})`;
      if (key === 'emphasis') css = value === 'high' ? '600' : value === 'low' ? '300' : '400';
      if (key === 'justify')
        css =
          (
            { between: 'space-between', around: 'space-around', evenly: 'space-evenly' } as Record<
              string,
              string
            >
          )[String(value)] ?? String(value);
      result[`--vr-${breakpoint}-${property}`] = css;
    }
  }
  return result;
}
const breakpoints = [
  ['base', 0],
  ['sm', 640],
  ['md', 768],
  ['lg', 1024],
  ['xl', 1280],
] as const;
/** Constant stylesheet; script input can only select validated custom-property token values. */
export const RUNTIME_STYLES =
  breakpoints
    .map(([name, min], index) => {
      const rules = Object.entries(initial)
        .map(([property, fallback]) => {
          let expression = fallback;
          if (property === 'padding-inline' || property === 'padding-block') {
            expression = '0';
            for (let i = 0; i <= index; i++)
              expression = `var(--vr-${breakpoints[i]?.[0] ?? 'base'}-padding, ${expression})`;
          }
          for (let i = 0; i <= index; i++)
            expression = `var(--vr-${breakpoints[i]?.[0] ?? 'base'}-${property}, ${expression})`;
          return `${property}:${expression}`;
        })
        .join(';');
      const css = `.vr-box{${rules}}`;
      return name === 'base' ? css : `@media(min-width:${min}px){${css}}`;
    })
    .join('\n') +
  '\n.vr-box[data-border=true]{border:1px solid var(--vb-color-border);border-radius:var(--vb-radius-md)}.vr-box[data-background=surface]{background:var(--vb-color-surface)}.vr-box[data-background=raised]{background:var(--vb-color-surface-raised)}.vr-box:focus-visible{outline:2px solid var(--vb-color-focus);outline-offset:2px}';
