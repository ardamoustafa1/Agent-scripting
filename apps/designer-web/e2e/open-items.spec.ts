import { ScriptDocumentSchema, validateScriptDocument } from '@verbis/script-schema';

import { expect, test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  permissionFixture,
} from '../src/test-fixtures.js';

test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: sessionFixture.user.tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/permissions')
      ? {
          ...permissionFixture,
          rules: [...permissionFixture.rules, ['update', 'Script'], ['read', 'Integration']],
        }
      : path.endsWith('/versions/1')
        ? editorFixture()
        : fixtureResponse(path);
    await route.fulfill({ json: body });
  });
});

test('tenant source selected in Designer binds the document and passes the publication validator', async ({
  page,
}) => {
  await page.route('**/api/v1/data-sources?*', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: '01928f3a-0000-7000-8000-000000000041',
            key: 'customer-profile',
            version: 3,
            protocol: 'rest',
          },
        ],
        page: { nextCursor: null },
      },
    }),
  );
  let saved: unknown;
  await page.route('**/api/v1/scripts/*/versions/1/document', async (route) => {
    saved = route.request().postDataJSON();
    expect(route.request().headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
    await route.fulfill({ json: { version: 2 } });
  });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page.getByRole('button', { name: 'Manage data sources', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Tenant integration', exact: true }).click();
  await page.getByRole('option', { name: 'customer-profile · v3', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add data source', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-component-type="webService"]').getByRole('button').last().click();
  await page
    .locator('.ed-inspector')
    .getByRole('combobox', { name: 'Data source', exact: true })
    .click();
  await page.getByRole('option', { name: 'customerProfile', exact: true }).click();
  await expect
    .poll(() => saved)
    .toMatchObject({
      document: {
        dataSources: [
          { id: 'customerProfile', ref: 'tenant-datasource:customer-profile', version: 3 },
        ],
      },
    });
  const document = ScriptDocumentSchema.parse((saved as { document: unknown }).document);
  expect(
    document.pages[0]?.layout.children?.some(
      (n) => (n['props'] as Record<string, unknown>)['ds'] === 'customerProfile',
    ),
  ).toBe(true);
  expect(validateScriptDocument(document).issues.filter((i) => i.severity === 'error')).toEqual([]);
});

test('repeated click insertion stays at page root and the palette has a keyboard jump', async ({
  page,
}) => {
  let saved: { document: unknown } | undefined;
  await page.route('**/api/v1/scripts/*/versions/1/document', async (route) => {
    saved = route.request().postDataJSON() as { document: unknown };
    await route.fulfill({ json: { version: 2 } });
  });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await page.locator('[data-component-type="box"]').getByRole('button').last().click();
  await page.locator('[data-component-type="card"]').getByRole('button').last().click();
  const root = page.locator('[data-editor-node="home-root"]').first();
  expect(await root.locator('[data-editor-node]').count()).toBe(3);
  await expect
    .poll(
      () => saved && ScriptDocumentSchema.parse(saved.document).pages[0]?.layout.children?.length,
    )
    .toBe(3);
  const inserted = ScriptDocumentSchema.parse(saved!.document).pages[0]!.layout.children!;
  expect(inserted.map((node) => node['type'])).toEqual(['button', 'box', 'card']);
  expect(inserted[1]!['children'] ?? []).toEqual([]);
  const boxButton = page.locator('[data-component-type="box"]').getByRole('button').last();
  await boxButton.focus();
  await page.keyboard.press('Shift+Space');
  await expect(page.locator('[id^=DndLiveRegion]')).toContainText('Box');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Jump to palette', exact: true })).toBeAttached();
  await expect(page.locator('[data-component-type="box"] .ed-grip')).toHaveAttribute(
    'tabindex',
    '-1',
  );
  const canvas = page.getByRole('group', { name: 'Screen canvas', exact: true });
  await canvas.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.ed-inspector')).toContainText('home-root');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ed-inspector')).toContainText('btn-next');
  await page.keyboard.press('Alt+ArrowDown');
  await expect
    .poll(
      () =>
        saved &&
        ScriptDocumentSchema.parse(saved.document).pages[0]?.layout.children?.[0]?.['type'],
    )
    .toBe('box');
});
