import { themeTokens, type ResolvedTheme } from './tokens.js';

const HEX = /^#[0-9a-f]{6}$/i;
function channels(color: string): [number, number, number] {
  if (!HEX.test(color)) throw new Error('Brand colors must use six-digit hexadecimal notation');
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}
export function luminance(color: string): number {
  const values = channels(color).map((value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
}
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export interface TenantBrand {
  readonly primaryColor: string;
  readonly logoUrl?: string;
  readonly name: string;
}
export function validateLogoUrl(url: string): string {
  if (
    /^\/(?!\/)/.test(url) &&
    !Array.from(url).some((char) => char === '\\' || char.charCodeAt(0) <= 32)
  )
    return url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('Logo must use a safe HTTPS or root-relative URL');
  return parsed.href;
}
/** Preserve hue when possible, darken/lighten toward a theme-safe endpoint when needed. */
export function accessibleBrand(
  color: string,
  theme: ResolvedTheme,
): { primary: string; foreground: string; focus: string } {
  const rgb = channels(color);
  if (theme === 'high-contrast')
    return {
      primary: themeTokens[theme].primary,
      foreground: themeTokens[theme]['primary-contrast'],
      focus: themeTokens[theme].focus,
    };
  const surfaces = [
    themeTokens[theme].bg,
    themeTokens[theme].surface,
    themeTokens[theme]['surface-raised'],
  ];
  const endpoint = theme === 'light' ? 0 : 255;
  let primary = color;
  for (let step = 0; step <= 255; step++) {
    primary =
      '#' +
      rgb
        .map((value) =>
          Math.round(value + ((endpoint - value) * step) / 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    if (surfaces.every((surface) => contrastRatio(primary, surface) >= 4.5)) break;
  }
  const foreground =
    contrastRatio(primary, '#ffffff') >= contrastRatio(primary, '#000000') ? '#ffffff' : '#000000';
  return { primary, foreground, focus: primary };
}
