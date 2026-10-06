/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  scriptFixture,
} from '../src/test-fixtures.js';

const cases = [
  ...['light', 'dark', 'high-contrast'].flatMap((theme) =>
    [320, 768, 1440].map((width) => ({ theme, width, locale: 'tr' })),
  ),
  { theme: 'light', width: 1440, locale: 'en' },
];
for (const { width, theme, locale } of cases) {
  test(`lifecycle controls stay readable ${locale} ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      ({ theme, locale, tenant, user }) => {
        localStorage.setItem('verbis.theme', theme);
        localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
        Object.defineProperty(navigator, 'languages', { get: () => [locale] });
      },
      { theme, locale, tenant: tenantId, user: sessionFixture.user.id },
    );
    const longName =
      locale === 'tr'
        ? 'QA — Kurumsal kargo destek ve müşteri karşılama operasyonu'
        : 'QA — Enterprise parcel support and customer welcome operation';
    const scriptDocument = {
      ...editorFixture().document,
      meta: { ...editorFixture().document.meta, name: longName },
    };
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        let body: unknown;
        if (path === `/api/v1/scripts/${scriptId}`) body = { ...scriptFixture, name: longName };
        else if (path.endsWith('/versions'))
          body = {
            data: [
              {
                id: editorFixture().id,
                number: 1,
                state: 'draft',
                createdBy: 'Synthetic designer',
                createdAt: '2026-10-05T14:12:04Z',
              },
            ],
            page: { nextCursor: null },
          };
        else if (path.endsWith('/versions/1'))
          body = { ...editorFixture(), document: scriptDocument, state: 'draft', number: 1 };
        else if (path.includes('/diff/')) body = { patch: [] };
        else if (path.endsWith('/regression'))
          body = {
            passed: true,
            version: 1,
            checksum: 'a'.repeat(64),
            checkedAt: '2026-10-05T14:12:04Z',
            results: [
              {
                id: 'synthetic-end',
                passed: true,
                durationMs: 1,
                assertions: [{ path: 'ended', passed: true }],
              },
            ],
          };
        else if (
          ['/reviews', '/schedules', '/comments', '/team-members', '/authoring-notifications'].some(
            (suffix) => path.endsWith(suffix),
          )
        )
          body = [];
        else body = fixtureResponse(path + url.search);
        return route.fulfill({ json: body });
      },
    );
    await page.goto(`/scripts/${scriptId}/releases`);
    await expect(page.locator('.dw-script-header h1')).toHaveText(longName);
    const trigger = page.getByRole('button', {
      name: locale === 'tr' ? 'Yayın öncesi regresyon' : 'Pre-publication regression',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.closest('td') === null)).toBe(true);
    const run = dialog.getByRole('button', {
      name: locale === 'tr' ? 'Kayıtlı senaryoları çalıştır' : 'Run saved scenarios',
    });
    await expect(run).toBeVisible();
    expect(await run.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await run.click();
    await expect(dialog.getByRole('status')).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page
      .getByRole('link', {
        name: locale === 'tr' ? 'İncele / yayınla' : 'Review / release',
        exact: true,
      })
      .click();
    await expect(page.locator('.lc-release-title h1')).toHaveText(longName);
    const heading = page.locator('.lc-release-header');
    const editor = heading.getByRole('link', {
      name: locale === 'tr' ? 'Ekran editörü' : 'Screen editor',
    });
    await expect(editor).toHaveAttribute('href', `/scripts/${scriptId}/versions/1/edit`);
    expect(await editor.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe(
      'none',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const regions = await page.locator('.lc-release-header, .lc-card, .pv-regression').all();
    for (const region of regions)
      expect(
        await region.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
    const title = await page.locator('.lc-release-identity').boundingBox();
    const actions = await page.locator('.lc-release-header-actions').boundingBox();
    if (width === 1440) expect(title!.x + title!.width).toBeLessThanOrEqual(actions!.x);
    else expect(actions!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results/lifecycle-layout-${locale}-${theme}-${width}.png`,
      fullPage: true,
    });
  });
}
