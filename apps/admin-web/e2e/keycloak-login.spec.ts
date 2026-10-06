import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';

/**
 * End-to-end SSO against the dev Keycloak realm (OIDC Authorization Code + PKCE through the BFF).
 * Needs the dev stack (docker compose up -d), `pnpm db:migrate && pnpm seed`, the API on :4000 and
 * this app; run with `E2E_KEYCLOAK=1 pnpm --filter @verbis/admin-web e2e --project keycloak`.
 */
const password = process.env['DEV_USER_ADMIN_PASSWORD'] ?? '';
if (process.env['E2E_KEYCLOAK'] === '1' && !password)
  throw new Error('DEV_USER_ADMIN_PASSWORD is required for OIDC acceptance');

test.use({ locale: 'en-US' });
test.skip(process.env['E2E_KEYCLOAK'] !== '1' || password === '', 'Keycloak e2e disabled');

test('signs in with Keycloak, keeps tokens out of the browser, and signs out', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  await page.getByLabel('Work email').fill('admin@verbis.test');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('link', { name: 'Sign in with Keycloak (dev)' }).click();

  await page.waitForURL(/\/realms\/verbis-dev\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();

  await page.waitForURL((url) => url.origin === appOrigin && url.pathname === '/');
  await expect(page.getByText('SSO session')).toBeVisible();

  // The only credential is the httpOnly session cookie; no tokens in script-readable storage.
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === '__Host-verbis_session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  // Evaluated in the page (string form: the e2e tsconfig has no DOM lib).
  const storage = await page.evaluate<string>(
    "[...Object.values(localStorage), ...Object.values(sessionStorage), document.cookie].join(' ')",
  );
  expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/' && !url.href.includes('/realms/'));
  await expect(page.getByLabel('Work email')).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-verbis_session')).toBe(
    false,
  );
});

test('a failed sign-in comes back with a readable error and no session', async ({
  page,
  context,
}) => {
  await page.goto('/api/auth/login?tenant=verbis-dev&app=admin');
  await page.waitForURL(/\/realms\/verbis-dev\//);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('definitely-wrong-password');
  await page.locator('#kc-login').click();
  await expect(
    page.locator('#input-error, .kc-feedback-text, [id*="error"]').first(),
  ).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-verbis_session')).toBe(
    false,
  );
});
