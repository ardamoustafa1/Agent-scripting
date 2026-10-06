import { AxeBuilder } from '@axe-core/playwright';

import { expect, test, type Page, type Route } from '../../../tests/playwright/test.js';

test.use({ locale: 'en-US' });

const CODE = 'Q'.repeat(43);
const SESSION_ID = '0190f000-0000-7000-8000-00000000abcd';
const CSRF = 'csrf-test-token';

interface Calls {
  redeem: unknown[];
  jws: unknown[];
  embedded: unknown[];
  signals: unknown[];
  urls: string[];
}

/** The API is mocked: these tests pin the browser contract (fragment only, scrubbed, never params). */
async function mockApi(
  page: Page,
  options: {
    session?: 'sso' | 'break_glass' | 'none';
    launch?: { status: number; code?: string };
  } = {},
): Promise<Calls> {
  const calls: Calls = { redeem: [], jws: [], embedded: [], signals: [], urls: [] };
  const launch = options.launch ?? { status: 201 };
  const reply = (route: Route) =>
    launch.status === 201
      ? route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ sessionId: SESSION_ID, path: `/s/${SESSION_ID}` }),
        })
      : route.fulfill({
          status: launch.status,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            code: launch.code ?? 'VERBIS_LAUNCH_DENIED',
            status: launch.status,
          }),
        });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.urls.push(url.pathname + url.search);
    if (url.pathname === '/api/health/ready')
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"status":"error"}',
      });
    if (url.pathname === '/api/auth/session') {
      if ((options.session ?? 'sso') === 'none') return route.fulfill({ status: 401, body: '{}' });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'u',
            tenantId: '0190f000-0000-7000-8000-00000000abce',
            authMethod: options.session ?? 'sso',
          },
          csrfToken: CSRF,
        }),
      });
    }
    if (request.method() === 'POST') expect(request.headers()['x-csrf-token']).toBe(CSRF);
    const body: unknown = request.postDataJSON();
    if (url.pathname === '/api/v1/launch/redeem') return (calls.redeem.push(body), reply(route));
    if (url.pathname === '/api/v1/launch/jws') return (calls.jws.push(body), reply(route));
    if (url.pathname === '/api/v1/launch/embedded')
      return (calls.embedded.push(body), reply(route));
    if (url.pathname === '/api/v1/launch/param-signals')
      return (calls.signals.push(body), route.fulfill({ status: 204 }));
    if (url.pathname === '/api/v1/launch/socket-ticket')
      return route.fulfill({ status: 503, body: '{}' });
    return route.fulfill({ status: 404, body: '{}' });
  });
  return calls;
}

test('opens a session from a fragment code and scrubs it from the URL immediately', async ({
  page,
}) => {
  const calls = await mockApi(page);
  await page.goto(`/launch#code=${CODE}`);
  await expect(page).toHaveURL(new RegExp(`/s/${SESSION_ID}$`));
  expect(calls.redeem).toEqual([{ code: CODE }]);
  // The code never travelled in a URL and is gone from history.
  expect(calls.urls.join(' ')).not.toContain(CODE);
  await page.goBack();
  await expect(page).toHaveURL(/\/launch$/);
  expect(page.url()).not.toContain(CODE);
});

test('fake URL parameters never open a script and are reported as a signal', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/launch?scriptId=s1&campaignId=c1&userId=u1&interactionId=i1');
  await expect(page.getByRole('alert')).toContainText('nothing to open');
  expect(calls.redeem).toEqual([]);
  expect(calls.embedded).toEqual([]);
  expect(calls.signals).toEqual([
    { params: ['campaignid', 'interactionid', 'scriptid', 'userid'] },
  ]);
  expect(calls.urls.filter((u) => /s1|c1|u1|i1/.test(u))).toEqual([]);
  await expect(page).toHaveURL(/\/launch$/);
  // Parameters on a session path do not select content either.
  await page.goto(`/s/${SESSION_ID}?scriptId=s1`);
  await expect(page.getByText('s1', { exact: true })).toHaveCount(0);
});

for (const [name, launch] of [
  ['a replayed code', { status: 403 }],
  ["another user's code", { status: 403 }],
  ['an expired code', { status: 403 }],
  ['a code from another tenant', { status: 403 }],
] as const) {
  test(`refuses ${name} without opening anything`, async ({ page }) => {
    const calls = await mockApi(page, { launch });
    await page.goto(`/launch#code=${CODE}`);
    await expect(page.getByRole('alert')).toContainText('This launch is not valid');
    await expect(page).toHaveURL(/\/launch$/);
    expect(calls.redeem).toHaveLength(1);
  });
}

test('refuses a tampered CTI-less token', async ({ page }) => {
  const calls = await mockApi(page, { launch: { status: 403 } });
  await page.goto('/launch#jws=invalid.tampered.token');
  await expect(page.getByRole('alert')).toContainText('This launch is not valid');
  expect(calls.jws).toHaveLength(1);
  expect(page.url()).not.toContain('invalid.tampered.token');
});

test('rejects malformed CTI-less material before sending any redemption request', async ({
  page,
}) => {
  const calls = await mockApi(page);
  await page.goto('/launch#jws=invalid-tampered-token');
  await expect(page.getByRole('alert')).toContainText('nothing to open');
  expect(calls.jws).toHaveLength(0);
  await expect(page).toHaveURL(/\/launch$/);
});

test('rate limiting is explained', async ({ page }) => {
  await mockApi(page, { launch: { status: 429, code: 'VERBIS_LAUNCH_RATE_LIMITED' } });
  await page.goto(`/launch#code=${CODE}`);
  await expect(page.getByRole('alert')).toContainText('Too many failed attempts');
});

test('embedded hint is sent for server-side platform verification only', async ({ page }) => {
  const calls = await mockApi(page, { launch: { status: 403 } });
  const connector = '0190f000-0000-7000-8000-000000000001';
  await page.goto(`/launch#connector=${connector}&conversation=conv-42`);
  await expect(page.getByRole('alert')).toContainText('This launch is not valid');
  expect(calls.embedded).toEqual([{ connectorId: connector, conversationId: 'conv-42' }]);
});

for (const [session, message] of [
  ['none', 'single sign-on'],
  ['break_glass', 'Break-glass'],
] as const) {
  test(`requires an SSO session: ${session} cannot launch`, async ({ page }) => {
    const calls = await mockApi(page, { session });
    await page.goto(`/launch#code=${CODE}`);
    await expect(page.getByRole('alert')).toContainText(message);
    expect(calls.redeem).toEqual([]);
  });
}

test('launch page has no WCAG 2.2 AA violations', async ({ page }) => {
  await mockApi(page, { launch: { status: 403 } });
  await page.goto(`/launch#code=${CODE}`);
  await expect(page.getByRole('alert')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
