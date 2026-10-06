import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { browserNonce, escapeTemplateValue, SafeRichText } from './security.js';

describe('rich text trust boundary', () => {
  it.each([
    '<img src=x onerror=alert(1)><strong>safe</strong>',
    '<svg><script>alert(1)</script></svg><strong>safe</strong>',
    '<math><mtext><img src=x onerror=alert(1)></mtext></math><strong>safe</strong>',
    '<a href="javascript:alert(1)">link</a><strong onclick=alert(1)>safe</strong>',
    '<style>*{background:url(https://attacker.test)}</style><strong style="color:red">safe</strong>',
  ])('removes executable markup and all attributes', (source) => {
    const { container } = render(<SafeRichText source={source} />);
    expect(container.querySelector('script,img,svg,math,style,a')).toBeNull();
    expect(container.querySelector('strong')?.attributes.length).toBe(0);
    expect(container.textContent).toContain('safe');
  });
  it('interpolated markup remains a literal text value', () => {
    const attack = '<strong onclick="alert(1)">customer</strong>';
    const { container } = render(<SafeRichText source={`<p>${escapeTemplateValue(attack)}</p>`} />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe(attack);
  });
  it('rejects unbounded markup', () => {
    expect(() => SafeRichText({ source: 'x'.repeat(65537) })).toThrow();
  });
  it('does not treat the Vite placeholder as an edge nonce', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'csp-nonce');
    meta.nonce = '__VERBIS_CSP_NONCE__';
    document.head.append(meta);
    expect(browserNonce()).toBe('');
    meta.remove();
  });
});
it('initializes the style nonce only from an actual edge nonce', async () => {
  const { initializeBrowserSecurity } = await import('./security.js');
  Reflect.deleteProperty(globalThis, '__webpack_nonce__');
  initializeBrowserSecurity();
  expect(Reflect.get(globalThis, '__webpack_nonce__')).toBeUndefined();
  const meta = document.createElement('meta');
  meta.setAttribute('property', 'csp-nonce');
  meta.nonce = 'nonce12345678901234567890123456789';
  document.head.append(meta);
  try {
    initializeBrowserSecurity();
    expect(Reflect.get(globalThis, '__webpack_nonce__')).toBe(meta.nonce);
  } finally {
    meta.remove();
    Reflect.deleteProperty(globalThis, '__webpack_nonce__');
  }
});
