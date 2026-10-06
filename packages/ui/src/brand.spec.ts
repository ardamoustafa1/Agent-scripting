import { describe, expect, it } from 'vitest';

import { accessibleBrand, contrastRatio, validateLogoUrl } from './brand.js';
import { themeTokens } from './tokens.js';

describe('accessible tenant branding', () => {
  for (const theme of ['light', 'dark', 'high-contrast'] as const)
    for (const input of [
      '#ffffff',
      '#000000',
      '#ffff00',
      '#ff0000',
      '#0000ff',
      '#00ff00',
      '#808080',
      '#5145cd',
    ])
      it(`${input} maintains text and focus contrast in ${theme}`, () => {
        const brand = accessibleBrand(input, theme);
        expect(contrastRatio(brand.primary, brand.foreground)).toBeGreaterThanOrEqual(4.5);
        for (const surface of [
          themeTokens[theme].bg,
          themeTokens[theme].surface,
          themeTokens[theme]['surface-raised'],
        ]) {
          expect(contrastRatio(brand.primary, surface)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(brand.focus, surface)).toBeGreaterThanOrEqual(3);
        }
      });
  it('rejects unsafe colors and logo URLs', () => {
    expect(() => accessibleBrand('red; background:url(x)', 'light')).toThrow();
    for (const url of [
      'javascript:alert(1)',
      'http://example.test/logo.svg',
      '//example.test/logo.svg',
      'https://user:password@example.test/logo.svg',
      '/\\example.test/logo.svg',
    ])
      expect(() => validateLogoUrl(url)).toThrow();
    expect(validateLogoUrl('/assets/logo.svg')).toBe('/assets/logo.svg');
    expect(validateLogoUrl('https://example.test/logo.svg')).toBe('https://example.test/logo.svg');
  });
  it('uses canonical WCAG luminance', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });
});
