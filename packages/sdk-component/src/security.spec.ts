import { expect, it } from 'vitest';

import { sandboxDocument } from './bundle.js';

it('uses unique script/style nonces and denies plugin network and HTML sinks', () => {
  const one = sandboxDocument('data:application/javascript;base64,ZXhwb3J0IHt9'),
    two = sandboxDocument('data:application/javascript;base64,ZXhwb3J0IHt9');
  const nonce = /<script nonce="([a-f0-9]{32})"/.exec(one)?.[1];
  expect(nonce).toBeTruthy();
  expect(two).not.toContain(nonce);
  expect(one).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
  expect(one).not.toContain('unsafe-inline');
  expect(one).not.toContain('script-src data:');
  expect(one).toContain("connect-src 'none'");
  expect(one).toContain("trusted-types 'none'");
});
it.each([
  'https://attacker.test/code.js',
  'data:text/html;base64,AAAA',
  'data:application/javascript;base64,AAA" onload="evil',
])('rejects invalid bootstrap input', (input) => {
  expect(() => sandboxDocument(input)).toThrow();
});
