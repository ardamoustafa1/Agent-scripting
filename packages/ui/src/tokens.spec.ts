import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from './brand.js';
import { baseTokens, themeTokens, token } from './tokens.js';

const css = readFileSync(`${import.meta.dirname}/tokens.css`, 'utf8');
describe('CSS and TypeScript token contract', () => {
  it('declares every typed token in CSS', () => {
    for (const [name, value] of Object.entries(baseTokens))
      expect(css).toContain(`--vb-${name}: ${value};`);
    for (const palette of Object.values(themeTokens))
      for (const [name, value] of Object.entries(palette))
        expect(css).toContain(`--vb-color-${name}: ${value};`);
    expect(token('space-4')).toBe('var(--vb-space-4)');
  });
  for (const [name, palette] of Object.entries(themeTokens))
    it(`${name} has accessible text, brand and semantic pairs`, () => {
      for (const surface of [palette.bg, palette.surface, palette['surface-raised']]) {
        expect(contrastRatio(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette['text-muted'], surface)).toBeGreaterThanOrEqual(4.5);
      }
      for (const key of ['brand-text', 'brand-muted', 'brand-accent'] as const)
        expect(contrastRatio(palette[key], palette['brand-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.primary, palette['primary-contrast'])).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const tone of ['success', 'warning', 'danger', 'info'] as const)
        expect(contrastRatio(palette[tone], palette[`${tone}-soft`])).toBeGreaterThanOrEqual(4.5);
    });
  it('respects reduced motion and logical direction', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('forced-colors: active');
    expect(css).toContain('inset-inline-end');
  });
});

describe('stacking order', () => {
  const z = (name: string) => Number(baseTokens[name as keyof typeof baseTokens]);
  it('renders portalled popovers (select, combobox, menu) above a modal dialog and its overlay', () => {
    // D-11/D-28: a Select inside a Dialog was painted behind the overlay and ate mouse clicks.
    expect(z('z-popover')).toBeGreaterThan(z('z-overlay'));
    expect(z('z-popover')).toBeGreaterThan(z('z-dialog'));
    expect(z('z-popover')).toBeLessThan(z('z-toast'));
    expect(z('z-tooltip')).toBeGreaterThan(z('z-popover'));
  });
});
