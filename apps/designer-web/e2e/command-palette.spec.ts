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

// DIFFERENTIATORS A2: one ⌘K palette with the editor's commands leading.
test.use({ locale: 'en-US' });

async function open(page: Page) {
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
        : route.request().method() === 'PUT'
          ? { version: 2 }
          : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
}
const palette = (page: Page) => page.getByRole('dialog', { name: 'Search commands' });
async function run(page: Page, query: string, option: string | RegExp) {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.type(query);
  await expect(palette(page).getByRole('option', { name: option }).first()).toBeVisible();
  await expect(palette(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(palette(page).getByRole('option').first()).toHaveAccessibleName(option);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
}

test('editor commands lead the palette and run from the keyboard', async ({ page }, info) => {
  await open(page);
  await page.keyboard.press('ControlOrMeta+k');
  const groups = palette(page).getByRole('group');
  await expect(groups.first()).toHaveAccessibleName('This script');
  await page.keyboard.press('Escape');

  await run(page, 'script health', 'Open script health');
  await expect(page.getByRole('dialog', { name: 'Script health' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Find a component by its rendered text and land on it with the canvas focused.
  await run(page, 'next', /^Button on Home/);
  await expect(page.locator('#editor-canvas')).toBeFocused();
  await expect(page.locator('.ed-selection-label')).toContainText('button');

  await run(page, 'add text input', /^Add Text input/);
  await expect(page.locator('.ed-selection-label')).toContainText('textInput');

  await run(page, 'flow', 'Open Flow');
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Recently run commands come first next time; the current mode is not offered again.
  await page.keyboard.press('ControlOrMeta+k');
  const recent = palette(page).getByRole('group', { name: 'Recent' });
  await expect(recent.getByRole('option')).toHaveText([/^Add Text input/, /^Open script health/]);
  // Audit the settled dialog, not a frame of its fade-in.
  await palette(page).evaluate((el) =>
    Promise.all(
      [el, ...document.querySelectorAll('.vb-overlay')].flatMap((node) =>
        node.getAnimations().map((animation) => animation.finished),
      ),
    ),
  );
  await page.keyboard.type('ad');
  await page.screenshot({ path: info.outputPath('command-palette.png') });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  const { violations } = await new AxeBuilder({ page })
    .include('[role=dialog]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});

test('editor commands disappear once the editor is left', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('script health');
  await expect(palette(page).getByText('No results found')).toBeVisible();
});
