import { expect, test } from '../../../tests/playwright/test.js';

const enabled = process.env['E2E_LIVE'] === '1';
const required = (key: string) => {
  const value = process.env[key];
  if (enabled && !value) throw new Error(`${key} is required for live SAML browser acceptance`);
  return value ?? '';
};
const tenant = required('SAML_E2E_TENANT');
const idp = required('SAML_E2E_IDP_ID');
const username = required('SAML_E2E_USERNAME');
const password = required('SAML_E2E_PASSWORD');
const idpOrigin = required('SAML_E2E_IDP_ORIGIN');
test.use({ locale: 'en-US', trace: 'off', screenshot: 'off', video: 'off' });
test('SAML SP initiated sign in creates a protected BFF session and signs out', async ({
  page,
  context,
}) => {
  test.skip(!enabled, 'Live SAML IdP and synthetic tenant required');
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await page.goto(
    `/api/auth/login?tenant=${encodeURIComponent(tenant)}&app=admin&idp=${encodeURIComponent(idp)}`,
  );
  await page.waitForURL((url) => url.origin === idpOrigin);
  // Default selectors target a synthetic Keycloak SAML client, configurable for another test IdP.
  await page.locator(process.env['SAML_E2E_USERNAME_SELECTOR'] ?? '#username').fill(username);
  await page.locator(process.env['SAML_E2E_PASSWORD_SELECTOR'] ?? '#password').fill(password);
  await page.locator(process.env['SAML_E2E_SUBMIT_SELECTOR'] ?? '#kc-login').click();
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith('/api/auth'));
  await expect(page.getByText('SSO session')).toBeVisible();
  const response = await page.request.get('/api/auth/session');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ session: { protocol: 'saml' } });
  expect(
    (await context.cookies()).find((cookie) => cookie.name === '__Host-verbis_session'),
  ).toMatchObject({ httpOnly: true, secure: true, path: '/' });
  expect(
    await page.evaluate(
      "Object.values(localStorage).concat(Object.values(sessionStorage), document.cookie).join(' ')",
    ),
  ).not.toMatch(/SAMLResponse|<saml|eyJ[A-Za-z0-9_-]+\./);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Work email')).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-verbis_session')).toBe(
    false,
  );
});

test('SAML ACS rejects an unsigned assertion without creating a session', async ({
  page,
  context,
}) => {
  test.skip(!enabled, 'Live SAML tenant required');
  const response = await page.request.post(
    `/api/auth/saml/${encodeURIComponent(tenant)}/${encodeURIComponent(idp)}/acs`,
    {
      form: {
        SAMLResponse: Buffer.from('<unsigned-assertion/>').toString('base64'),
        RelayState: 'synthetic-invalid-relay',
      },
    },
  );
  expect([400, 401, 403]).toContain(response.status());
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-verbis_session')).toBe(
    false,
  );
});
