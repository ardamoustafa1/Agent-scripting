import { AxeBuilder } from '@axe-core/playwright';

import {
  IntegrationDefinitionSchema,
  IntegrationPolicySchema,
  IntegrationSaveSchema,
} from '@verbis/shared-types';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  sessionFixture,
  permissionFixture,
  tenantId,
} from '../src/test-fixtures.js';

const id = '00000000-0000-4000-8000-000000000004';
const source = {
  id,
  key: 'customer-lookup',
  protocol: 'rest',
  version: 1,
  definition: IntegrationDefinitionSchema.parse({
    baseUrl: 'https://api.example.com',
    endpoint: '/customers/{{input.id}}',
    mock: { enabled: false, response: { customer: { name: 'Synthetic' } } },
    profiles: { test: { baseUrl: 'https://test.example.com', auth: { type: 'none' } } },
  }),
  policy: IntegrationPolicySchema.parse({}),
};
test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/permissions')
      ? {
          ...permissionFixture,
          rules: [
            ...permissionFixture.rules,
            ['read', 'Integration'],
            ['create', 'Integration'],
            ['update', 'Integration'],
            ['execute', 'Integration'],
            ['read', 'Secret'],
          ],
        }
      : url.pathname.endsWith('/data-sources')
        ? { data: [source], page: { nextCursor: null } }
        : url.pathname.endsWith('/preview')
          ? {
              request: { headers: { Authorization: '[REDACTED]' } },
              response: { customer: '[REDACTED]' },
              mapped: { result: '[REDACTED]' },
              durationMs: 2,
              error: null,
              mock: true,
              cached: false,
            }
          : url.pathname.endsWith('/metrics')
            ? [
                {
                  profile: 'dev',
                  calls: 10,
                  errors: 1,
                  errorRate: 0.1,
                  p50: 5,
                  p95: 12,
                  p99: 15,
                  breaker: 0,
                },
              ]
            : url.pathname.endsWith('/usage')
              ? { data: [], truncated: false }
              : url.pathname.endsWith('/secrets')
                ? {
                    data: [
                      {
                        id: '00000000-0000-4000-8000-000000000005',
                        name: 'Synthetic metadata',
                        kind: 'api_key',
                        keyVersion: 1,
                      },
                    ],
                    page: { nextCursor: null },
                  }
                : url.pathname.endsWith(`/data-sources/${id}`)
                  ? source
                  : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
});
test('opens protocol, health and consumer list, then edits a service', async ({ page }) => {
  await page.goto('/integrations');
  await page.getByRole('link', { name: 'customer-lookup', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'URL template', exact: true })).toHaveValue(
    '/customers/{{input.id}}',
  );
  await page.getByRole('tab', { name: 'Test console', exact: true }).click();
  const preview = page.waitForRequest((r) => r.url().endsWith('/data-sources/preview'));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const request = await preview;
  expect(request.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  await expect(page.locator('.ig-code')).toContainText('[REDACTED]');
});
test('cURL import is data-only and rejects embedded credentials', async ({ page }) => {
  await page.goto('/integrations/new');
  await page
    .getByRole('textbox', { name: 'cURL / OpenAPI / WSDL source', exact: true })
    .fill("curl https://api.example.com -H 'Authorization: Bearer synthetic'");
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Import failed');
});
test('production profiles are read-only and promotion requires a saved draft and reason', async ({
  page,
}) => {
  await page.goto(`/integrations/${id}`);
  await page.getByRole('tab', { name: 'Profiles / approvals', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Request production promotion', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('textbox', { name: 'Profile base URL / auth', exact: true }).last(),
  ).toBeDisabled();
});
for (const theme of ['light', 'dark', 'high-contrast'])
  test(`integration editor ${theme} keyboard and axe`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.goto(`/integrations/${id}`);
    await expect(
      page.getByRole('tab', { name: 'Profiles / approvals', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

test('creates a REST service without exposing credentials to the script', async ({ page }) => {
  await page.route('**/api/v1/data-sources', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
    const body = IntegrationSaveSchema.parse(route.request().postDataJSON());
    expect(body).toMatchObject({
      key: 'synthetic-lookup',
      protocol: 'rest',
      definition: { baseUrl: 'https://api.example.test', endpoint: '/lookup' },
    });
    expect(JSON.stringify(body)).not.toMatch(/Bearer|password/);
    await route.fulfill({
      status: 201,
      json: { ...source, key: body.key, definition: body.definition, policy: body.policy },
    });
  });
  await page.goto('/integrations/new');
  await page.getByRole('tab', { name: 'Request', exact: true }).click();
  await page.getByLabel('Integration key', { exact: true }).fill('synthetic-lookup');
  await page.getByLabel('Base URL', { exact: true }).fill('https://api.example.test');
  await page.getByLabel('URL template', { exact: true }).fill('/lookup');
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/data-sources'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await response).status()).toBe(201);
});

test('restores saved visual mappings across tabs and preserves fields when extending them', async ({
  page,
}) => {
  await page.route(`**/api/v1/data-sources/${id}`, (route) =>
    route.fulfill({
      json: {
        ...source,
        definition: { ...source.definition, mapping: { response: '{"result": customer.name}' } },
      },
    }),
  );
  await page.goto(`/integrations/${id}`);
  await page.getByRole('tab', { name: 'Mapping', exact: true }).click();
  await expect(page.locator('.ig-drop')).toContainText('result');
  await page.getByRole('tab', { name: 'Request', exact: true }).click();
  await page.getByRole('tab', { name: 'Mapping', exact: true }).click();
  await page.getByLabel('Target field', { exact: true }).fill('customerName');
  await page.getByRole('combobox', { name: 'Source field', exact: true }).click();
  await page.getByRole('option', { name: 'customer.name', exact: true }).click();
  await page.getByRole('button', { name: 'Map field', exact: true }).click();
  await expect(page.getByLabel('Advanced JSONata response mapping', { exact: true })).toHaveValue(
    '{"result": customer.name, "customerName": customer.name}',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('console refuses malformed JSON instead of executing its previous valid input', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/v1/data-sources/preview', (route) => {
    calls += 1;
    return route.fulfill({
      json: {
        request: null,
        response: {},
        mapped: {},
        durationMs: 1,
        cached: false,
        mock: true,
        error: null,
      },
    });
  });
  await page.goto(`/integrations/${id}`);
  await page.getByRole('tab', { name: 'Test console', exact: true }).click();
  await page.getByLabel('Test input (JSON)', { exact: true }).fill('{bad-json');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Test failed' })).toBeVisible();
  expect(calls).toBe(0);
  await expect(page.locator('.ig-code')).toHaveCount(0);
  await page.getByLabel('Test input (JSON)', { exact: true }).fill('{}');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.ig-code')).toContainText('"mock": true');
  expect(calls).toBe(1);
});
test('SQL form authors a named read-only query and passes axe', async ({ page }) => {
  await page.goto('/integrations/new');
  await page.getByRole('tab', { name: 'Request', exact: true }).click();
  await page.getByRole('combobox', { name: 'Protocol', exact: true }).click();
  await page.getByRole('option', { name: 'SQL', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Private gateway client ID', exact: true })
    .fill('01990000-0000-7000-8000-000000000001');
  await page.getByRole('textbox', { name: 'Gateway target', exact: true }).fill('crm-readonly');
  await page.getByRole('textbox', { name: 'Named query key', exact: true }).fill("x'; DROP--");
  await expect(page.getByText('Use lowercase letters', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Named query key', exact: true }).fill('customer-by-id');
  await page.getByRole('button', { name: 'Add parameter', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Input path for parameter 1', exact: true })
    .fill('customer.id');
  await expect(page.getByRole('textbox', { name: 'Base URL', exact: true })).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
