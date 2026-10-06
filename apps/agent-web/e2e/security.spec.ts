import { test, expect } from '../../../tests/playwright/test.js';

const target = process.env['SECURITY_BASE_URL'];
test.skip(!target, 'Requires actual production nginx edge, not Vite preview.');
test('strict CSP, response-specific nonces, Trusted Types and security headers', async ({
  page,
  request,
}) => {
  if (!target) throw new Error('Missing SECURITY_BASE_URL');
  const first = await request.get(target),
    second = await request.get(target);
  const csp = first.headers()['content-security-policy'] ?? '';
  const nonce = /script-src 'nonce-([^']+)' 'strict-dynamic'/.exec(csp)?.[1];
  expect(nonce).toMatch(/^[a-f0-9]{32}$/);
  expect(second.headers()['content-security-policy']).not.toContain(`nonce-${nonce}`);
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(first.headers()['strict-transport-security']).toContain('includeSubDomains');
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  expect(first.headers()['referrer-policy']).toBe('no-referrer');
  expect(first.headers()['cache-control']).toBe('no-store');
  expect(await first.text()).toContain(`nonce="${nonce}"`);
  const violations: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(window, '__securityViolations', { value: [] });
    window.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __securityViolations: string[] }).__securityViolations.push(
        event.violatedDirective,
      );
    });
  });
  await page.goto(target);
  await expect(page.locator('#root')).not.toBeEmpty();
  violations.push(
    ...(await page.evaluate(
      () => (window as unknown as { __securityViolations: string[] }).__securityViolations,
    )),
  );
  expect(violations).toEqual([]);
  const trustedTypesRejected = await page.evaluate(() => {
    try {
      document.createElement('div').innerHTML = '<img src=x onerror=alert(1)>';
      return false;
    } catch {
      return true;
    }
  });
  expect(trustedTypesRejected).toBe(true);
});
