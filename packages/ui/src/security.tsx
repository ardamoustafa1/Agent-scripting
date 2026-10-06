import DOMPurify from 'dompurify';
import { createElement, type ReactNode } from 'react';

/** The edge supplies a per-response nonce. Placeholder is never a production nonce. */
export function browserNonce(): string {
  const meta = document.querySelector<HTMLElement>('meta[property="csp-nonce"]');
  let nonce = meta?.nonce ?? '';
  if (nonce === '') nonce = meta?.getAttribute('nonce') ?? '';
  return /^[A-Za-z0-9+/_=-]{16,128}$/.test(nonce) && !nonce.includes('VERBIS') ? nonce : '';
}
export function initializeBrowserSecurity(): void {
  // Radix/react-remove-scroll uses get-nonce for its generated style elements.
  const nonce = browserNonce();
  if (nonce)
    Object.defineProperty(globalThis, '__webpack_nonce__', { value: nonce, configurable: true });
}
export function escapeTemplateValue(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
/** No innerHTML sink: DOMPurify returns a fragment converted to a narrow React tree. */
export function SafeRichText({ source }: { source: string }): ReactNode {
  if (source.length > 65_536) throw new Error('Rich text exceeds limit');
  const fragment = DOMPurify.sanitize(source, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'mark', 'ul', 'ol', 'li', 'h3', 'span'],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  function convert(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node as Element;
    return createElement(
      element.tagName.toLowerCase(),
      { key },
      ...Array.from(node.childNodes, convert),
    );
  }
  return Array.from(fragment.childNodes, convert);
}
