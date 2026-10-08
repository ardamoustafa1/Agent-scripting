import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  permissionFixture,
  scriptId,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

// The authoring promise ("the canvas is the content, the tools stay out of the way") as a
// measurable guard: DIFFERENTIATORS §0.1 asks for >=65% of the workspace at 1440 px.
test.use({ locale: 'en-US' });

async function open(page: Page, width: number, height: number) {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', 'light');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/versions/1')
      ? editorFixture()
      : url.pathname.endsWith('/permissions')
        ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
        : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width, height });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
}
const size = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const box = document.querySelector(s)?.getBoundingClientRect();
    return box ? { width: box.width, height: box.height } : null;
  }, selector);

test('the screen canvas keeps at least 65% of the workspace width at 1440 px', async ({ page }) => {
  await open(page, 1440, 900);
  const workspace = await size(page, '.ed-workspace');
  const canvas = await size(page, '#editor-canvas');
  expect(workspace && canvas).toBeTruthy();
  expect((canvas?.width ?? 0) / (workspace?.width ?? 1)).toBeGreaterThanOrEqual(0.65);
});

test('the rail opens collapsed on the editor and can be expanded for the visit', async ({
  page,
}) => {
  await open(page, 1440, 900);
  await expect(page.locator('.dw-workspace')).toHaveAttribute('data-sidebar-collapsed', 'true');
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(page.locator('.dw-workspace')).toHaveAttribute('data-sidebar-collapsed', 'false');
  // Not remembered: the saved preference was never touched.
  expect(await page.evaluate(() => localStorage.getItem('verbis.sidebar.collapsed'))).toBeNull();
});

test('the flow canvas stays usable on a 1280x720 screen', async ({ page }) => {
  await open(page, 1280, 720);
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name: 'Flow', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  const flow = await size(page, '.react-flow');
  expect(flow?.height ?? 0).toBeGreaterThanOrEqual(280);
  // The tool row scrolls sideways instead of wrapping into several rows.
  const rows = await page.evaluate(() => {
    const tools = document.querySelector('.fd-tools');
    return tools ? tools.getBoundingClientRect().height : 0;
  });
  expect(rows).toBeLessThan(100);
});
