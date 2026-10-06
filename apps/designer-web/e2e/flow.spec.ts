import { AxeBuilder } from '@axe-core/playwright';

import { VariableSchema } from '@verbis/script-schema';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

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
    const fixture = editorFixture();
    fixture.document.variables.push(
      VariableSchema.parse({ key: 'customer', type: 'string', default: '', scope: 'session' }),
    );
    fixture.document.pages[0]!.layout.visibleWhen = { $expr: 'vars.customer != ""' };
    const body =
      route.request().method() === 'PUT'
        ? { version: 2 }
        : url.pathname.endsWith('/versions/1')
          ? fixture
          : url.pathname.endsWith('/permissions')
            ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
            : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
});
async function openMode(page: Page, mode: string) {
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name: mode, exact: true }).click();
}
test('add, arrange, drag and undo a flow node; Page double-click opens its canvas', async ({
  page,
}) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await openMode(page, 'Flow');
  await page.getByRole('button', { name: 'Decision', exact: true }).click();
  await expect(page.locator('.react-flow__node-verbis')).toHaveCount(3);
  await expect(page.locator('.fd-node-issues')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  // ELK is asynchronous. Starting a drag before layout completes cancels that
  // layout and leaves the newly added node on top of the page node.
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  const node = page.locator('.react-flow__node-verbis[data-id="n-home"]');
  const rectangle = await node.boundingBox();
  if (!rectangle) throw new Error('Missing node');
  const position = () =>
    node.evaluate((element: { style: { transform: string } }) => element.style.transform);
  // The layout worker can still be settling after the button re-enables (slow CI runners).
  let before = await position();
  for (let stable = 0; stable < 3;) {
    await page.waitForTimeout(150);
    const current = await position();
    stable = current === before ? stable + 1 : 0;
    before = current;
  }
  const x = rectangle.x + rectangle.width / 2;
  const y = rectangle.y + rectangle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(position).not.toBe(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(position).toBe(before);
  await node.locator('.fd-node-title strong').dblclick();
  await expect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
});
test('rename commits all references atomically and uses CSRF + optimistic version', async ({
  page,
}) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await openMode(page, 'Variables');
  await page.getByRole('button', { name: 'customer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Variable name', exact: true }).fill('client');
  const request = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/document'));
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const saved = await request;
  expect(saved.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
  expect(saved.headers()['if-match']).toBeDefined();
  expect(JSON.stringify(saved.postDataJSON())).toContain('vars.client');
  expect(JSON.stringify(saved.postDataJSON())).not.toContain('vars.customer');
});
test('selects inside the variable dialog are usable with a real mouse (D-11/D-28)', async ({
  page,
}) => {
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await openMode(page, 'Variables');
  await page.getByRole('button', { name: 'customer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const kind = dialog.getByRole('combobox', { name: 'Type', exact: true });
  await kind.click();
  const option = page.getByRole('option', { name: 'Number', exact: true });
  // A real click (no force/keyboard): fails when the overlay intercepts pointer events.
  await option.click({ timeout: 3000 });
  await expect(kind).toContainText('Number');
});
for (const mode of ['Flow', 'Rules', 'Variables']) {
  for (const theme of ['light', 'dark', 'high-contrast']) {
    test(`${mode} ${theme} keyboard and axe`, async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('verbis.theme', value);
      }, theme);
      await page.goto(`/scripts/${scriptId}/versions/1/edit`);
      await openMode(page, mode);
      await page.keyboard.press('Tab');
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
}
