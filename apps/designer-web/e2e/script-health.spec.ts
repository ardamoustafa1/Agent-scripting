import { AxeBuilder } from '@axe-core/playwright';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

// DIFFERENTIATORS A4: Script Health panel.
test.use({ locale: 'en-US' });

function fixtureWithFindings() {
  const version = editorFixture();
  version.document.pages[0]?.layout.children?.push({
    id: 'customer-name',
    type: 'textInput',
    props: {},
    bindings: [],
    events: {},
  });
  version.document.variables.push({
    key: 'syntheticId',
    type: 'string',
    scope: 'session',
    pii: true,
    classification: 'pii',
    persist: false,
  });
  return version;
}

async function open(page: Page, theme: string, width = 1440) {
  await page.addInitScript(
    ({ tenant, user, value }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', value);
    },
    { tenant: tenantId, user: sessionFixture.user.id, value: theme },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/versions/1')
      ? fixtureWithFindings()
      : url.pathname.endsWith('/permissions')
        ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
        : route.request().method() === 'PUT'
          ? { version: 2 }
          : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
}

const axe = (page: Page) =>
  new AxeBuilder({ page })
    .include('.ed-health-sheet')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);

for (const theme of ['light', 'dark', 'high-contrast'])
  test(`health panel has no axe violations in the ${theme} theme`, async ({ page }, info) => {
    await open(page, theme);
    await page.getByRole('button', { name: /^Script health \d+ of 100/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Script health' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Privacy and compliance')).toBeVisible();
    await sheet.evaluate((el) =>
      Promise.all(
        [el, ...document.querySelectorAll('.vb-overlay')].flatMap((node) =>
          node.getAnimations().map((animation) => animation.finished),
        ),
      ),
    );
    await page.screenshot({ path: info.outputPath(`script-health-${theme}.png`) });
    const { violations } = await axe(page).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

test('go to selects the component and hands focus to the canvas', async ({ page }) => {
  await open(page, 'light');
  await page.getByRole('button', { name: /^Script health \d+ of 100/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Script health' });
  await sheet
    .getByRole('button', { name: /^Go to Home › / })
    .first()
    .click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#editor-canvas')).toBeFocused();
  await expect(page.locator('.ed-selection-label')).toContainText('textInput');
});

test('health panel fits a phone viewport without horizontal scroll', async ({ page }) => {
  await open(page, 'light', 390);
  await page.getByRole('button', { name: /^Script health \d+ of 100/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Script health' });
  await expect(sheet).toBeVisible();
  const overflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
