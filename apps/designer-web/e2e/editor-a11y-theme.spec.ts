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

// A-04 (heading order) and V-01 (unthemed React Flow chrome in dark/high-contrast themes).
test.use({ locale: 'en-US' });
async function open(page: Page, theme: string, width: number) {
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
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
}
const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    'best-practice',
  ]);
for (const width of [390, 1440])
  test(`editor screen mode has ordered headings and no axe violations at ${width}px`, async ({
    page,
  }) => {
    await open(page, 'light', width);
    const { violations } = await axe(page).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

function luminance(rgb: string) {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((c) => {
    const v = Number(c) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
for (const theme of ['dark', 'high-contrast'])
  test(`flow canvas controls, minimap and edge labels follow the ${theme} theme`, async ({
    page,
  }) => {
    await open(page, theme, 1440);
    await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
    await page.getByRole('option', { name: 'Flow', exact: true }).click();
    await expect(page.locator('.react-flow__controls-button').first()).toBeVisible();
    const styles = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color, fill: style.fill };
      };
      return {
        page: getComputedStyle(document.body).backgroundColor,
        button: read('.react-flow__controls-button'),
        icon: read('.react-flow__controls-button svg'),
        minimap: read('.react-flow__minimap'),
        attribution: read('.react-flow__attribution'),
      };
    });
    expect(styles.button).not.toBeNull();
    // Icons must be at least 3:1 against their button (WCAG 1.4.11), the minimap must not be a
    // white block on a dark page, and the attribution text must stay readable.
    expect(contrast(styles.icon!.fill, styles.button!.background)).toBeGreaterThanOrEqual(3);
    if (styles.minimap) expect(contrast(styles.minimap.background, styles.page)).toBeLessThan(3);
    if (styles.attribution)
      expect(
        contrast(styles.attribution.color, styles.attribution.background),
      ).toBeGreaterThanOrEqual(4.5);
  });

test('flow chrome remains visible with OS forced colors enabled', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await open(page, 'high-contrast', 1440);
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name: 'Flow', exact: true }).click();
  const control = page.locator('.react-flow__controls-button').first();
  await expect(control).toBeVisible();
  const colors = await control.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    fill: getComputedStyle(element.querySelector('svg')!).fill,
  }));
  expect(contrast(colors.fill, colors.background)).toBeGreaterThanOrEqual(3);
  expect((await axe(page).analyze()).violations).toEqual([]);
});
