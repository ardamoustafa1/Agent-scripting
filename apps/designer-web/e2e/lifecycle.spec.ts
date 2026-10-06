import { AxeBuilder } from '@axe-core/playwright';

import { test, expect } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  campaignId,
  sessionFixture,
  permissionFixture,
  tenantId,
  pageFixture,
} from '../src/test-fixtures.js';

const industries = ['banking', 'telecom', 'insurance', 'ecommerce', 'collections', 'survey'];
const builtins = [
  'builtin-credit-card-sales',
  'builtin-telecom-tariff-change',
  'builtin-insurance-renewal',
  'builtin-ecommerce-order',
  'builtin-collections',
  'builtin-nps-survey',
];
test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let body: unknown;
    if (path.endsWith('/permissions'))
      body = {
        ...permissionFixture,
        rules: [
          ...permissionFixture.rules,
          ['update', 'Script'],
          ['update', 'Campaign'],
          ['approve', 'Script'],
          ['publish', 'Script'],
        ],
      };
    else if (/\/versions\/\d+$/.test(path)) {
      const fixture = editorFixture(2),
        number = Number(path.split('/').at(-1));
      body = { ...fixture, number, state: number === 1 ? 'published' : 'draft' };
    } else if (path.includes('/versions?') || path.endsWith('/versions'))
      body = pageFixture([
        {
          id: editorFixture().id,
          number: 1,
          state: 'published',
          createdAt: '2026-10-02T10:00:00Z',
          createdBy: sessionFixture.user.id,
        },
        {
          id: '01928f3a-0000-7000-8000-000000000010',
          number: 2,
          state: 'draft',
          createdAt: '2026-10-02T11:00:00Z',
          createdBy: sessionFixture.user.id,
        },
      ]);
    else if (path.includes('/diff/'))
      body = { patch: [{ op: 'replace', path: '/meta/name', value: 'Synthetic revised name' }] };
    else if (path.endsWith('/team-members'))
      body = [{ id: sessionFixture.user.id, name: 'Synthetic reviewer' }];
    else if (
      path.endsWith('/comments') ||
      path.endsWith('/reviews') ||
      path.endsWith('/schedules') ||
      path.endsWith('/authoring-notifications')
    )
      body = [];
    else if (path.startsWith('/api/v1/assignments') && route.request().method() === 'GET')
      body = pageFixture([
        {
          id: '01928f3a-0000-7000-8000-000000000005',
          scriptId,
          campaignId,
          version: 1,
          priority: 10,
          effectiveFrom: null,
          effectiveTo: null,
          expression: null,
          variants: null,
        },
      ]);
    else if (path.endsWith('/templates'))
      body = industries.map((industry, i) => ({
        id: builtins[i],
        name: industry,
        category: 'service',
        description: null,
        tags: [industry],
        builtIn: true,
      }));
    else if (route.request().method() === 'POST') body = {};
    else body = fixtureResponse(path + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
});
test('requires a change note and submits it with the BFF CSRF token', async ({ page }) => {
  await page.goto(`/scripts/${scriptId}/versions/2/release`);
  await page.getByLabel('Semantic version').fill('2.0.0');
  const submit = page.getByRole('button', { name: 'Submit for review', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Change note (required)').fill('Synthetic legal text update');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/submit'));
  await submit.click();
  const request = await sent;
  expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  expect(request.postDataJSON()).toEqual({
    semver: '2.0.0',
    changeNote: 'Synthetic legal text update',
  });
});
test('continues authoring a published script in a new draft', async ({ page }) => {
  const source = { ...editorFixture(2), state: 'published' };
  await page.route(`**/api/v1/scripts/${scriptId}/versions?*`, (route) =>
    route.fulfill({
      json: pageFixture([
        {
          id: source.id,
          number: 1,
          state: 'published',
          createdAt: '2026-10-02T10:00:00Z',
          createdBy: sessionFixture.user.id,
        },
      ]),
    }),
  );
  await page.route(`**/api/v1/scripts/${scriptId}/versions/1`, (route) =>
    route.fulfill({ json: source }),
  );
  await page.route(`**/api/v1/scripts/${scriptId}/versions`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ document: source.document, screens: [] });
    expect(route.request().headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    await route.fulfill({ status: 201, json: { number: 2 } });
  });
  await page.goto(`/scripts/${scriptId}`);
  await page.getByRole('button', { name: 'Create new draft from latest version' }).click();
  await expect(page).toHaveURL(new RegExp(`/scripts/${scriptId}/versions/2/edit$`));
  await expect(page.getByRole('button', { name: /Undo/i })).toBeVisible();
});
test('exposes semantic and JSON diff modes with keyboard navigation', async ({ page }) => {
  await page.goto(`/scripts/${scriptId}/versions/2/release`);
  await expect(page.locator('.lc-diff-pair').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Raw JSON', exact: true }).click();
  await expect(page.getByText('/meta/name', { exact: false }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Raw JSON', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Data sources', exact: true })).toBeFocused();
});
test('filters the six industry templates without losing tenant gallery access', async ({
  page,
}) => {
  await page.goto('/templates');
  await expect(page.getByRole('button', { name: 'Use template', exact: true })).toHaveCount(6);
  await page.getByRole('combobox', { name: 'Industry', exact: true }).click();
  await page.getByRole('option', { name: 'Insurance', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use template', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
for (const theme of ['Light', 'Dark', 'High contrast'])
  test(`release accessibility in ${theme}`, async ({ page }) => {
    await page.goto(`/scripts/${scriptId}/versions/2/release`);
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByRole('menuitem', { name: theme, exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByLabel('Change note (required)')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

test('mention notification target opens the matching node thread', async ({ page }) => {
  const threadId = '01928f3a-0000-7000-8000-000000000020';
  await page.route(`**/api/v1/scripts/${scriptId}/versions/2/comments`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: threadId,
          nodeId: 'fixture-0',
          resolved: false,
          version: 1,
          messages: [
            {
              id: '01928f3a-0000-7000-8000-000000000021',
              author: `user:${sessionFixture.user.id}`,
              text: 'Synthetic node review',
              mentions: [sessionFixture.user.id],
              createdAt: '2026-10-02T10:00:00Z',
            },
          ],
        },
      ]),
    });
  });
  await page.goto(`/scripts/${scriptId}/versions/2/release?thread=${threadId}`);
  await expect(page.getByRole('heading', { name: 'Node comments fixture-0' })).toBeVisible();
  await expect(page.getByText('Synthetic node review', { exact: true })).toBeVisible();
});

test('approval and publication require passed regression, then update release state', async ({
  page,
}) => {
  let state: 'in_review' | 'approved' | 'published' = 'in_review';
  const actions: string[] = [];
  const prefix = `/api/v1/scripts/${scriptId}/versions/2`;
  await page.route(`**${prefix}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === prefix) return route.fulfill({ json: { ...editorFixture(), number: 2, state } });
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
    actions.push(path.split('/').at(-1)!);
    if (path.endsWith('/regression'))
      return route.fulfill({
        json: {
          passed: true,
          version: 1,
          checksum: 'a'.repeat(64),
          checkedAt: '2026-10-03T09:00:00Z',
          results: [
            {
              id: 'synthetic-end',
              passed: true,
              durationMs: 1,
              assertions: [{ path: 'ended', passed: true }],
            },
          ],
        },
      });
    if (path.endsWith('/reviews')) {
      expect(route.request().postDataJSON()).toEqual({
        decision: 'approved',
        comment: 'Synthetic independent review',
      });
      state = 'approved';
    } else if (path.endsWith('/publish')) state = 'published';
    else return route.fallback();
    await route.fulfill({ json: {} });
  });
  await page.goto(`/scripts/${scriptId}/versions/2/release`);
  const panel = page.getByRole('region', { name: 'Pre-publication regression' });
  await expect(panel.getByRole('button', { name: 'Approve version' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Run saved scenarios' }).click();
  await panel.getByLabel('Approval comment').fill('Synthetic independent review');
  await panel.getByRole('button', { name: 'Approve version' }).click();
  await expect(panel.getByRole('button', { name: 'Publish version' })).toBeVisible();
  // A separate release page must repeat regression against the approved version.
  await page.reload();
  await expect(panel.getByRole('button', { name: 'Publish version' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Run saved scenarios' }).click();
  await panel.getByRole('button', { name: 'Publish version' }).click();
  await expect.poll(() => state).toBe('published');
  expect(actions).toEqual(['regression', 'reviews', 'regression', 'publish']);
});

test('assigns the script to a campaign using the BFF CSRF boundary', async ({ page }) => {
  await page.goto(`/scripts/${scriptId}/assignments`);
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Demo campaign', exact: true }).click();
  await page.keyboard.press('Escape');
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/assignments/batch'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await request;
  expect(saved.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  expect(JSON.stringify(saved.postDataJSON())).toContain(scriptId);
  expect(JSON.stringify(saved.postDataJSON())).toContain(campaignId);
  expect(saved.postDataJSON()).toMatchObject({
    creates: [{ expression: { fact: 'interaction.channel', op: 'exists' } }],
  });
  await expect(page.getByRole('button', { name: 'Advanced expression', exact: true })).toHaveCount(
    0,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
