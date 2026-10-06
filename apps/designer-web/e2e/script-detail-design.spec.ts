/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  scriptFixture,
  scriptId,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

const cases = [
  ...['light', 'dark', 'high-contrast'].flatMap((theme) =>
    [320, 768, 1440].map((width) => ({ theme, width, locale: 'tr' })),
  ),
  { theme: 'light', width: 1440, locale: 'en' },
];
for (const { theme, width, locale } of cases) {
  test(`script detail ${locale} ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      ({ theme, tenant, user, locale }) => {
        localStorage.setItem('verbis.theme', theme);
        localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
        Object.defineProperty(navigator, 'languages', { get: () => [locale] });
      },
      { theme, tenant: tenantId, user: sessionFixture.user.id, locale },
    );
    let populated = false;
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === `/api/v1/scripts/${scriptId}`)
          return route.fulfill({
            json: {
              ...scriptFixture,
              name: locale === 'tr' ? 'Müşteri karşılama' : 'Customer welcome',
            },
          });
        if (url.pathname === `/api/v1/scripts/${scriptId}/versions`)
          return route.fulfill({
            json: {
              data: populated
                ? [
                    {
                      id: scriptId,
                      number: 1,
                      state: 'published',
                      createdBy: 'Designer',
                      createdAt: '2026-10-05T10:00:00Z',
                    },
                  ]
                : [],
              page: { nextCursor: null },
            },
          });
        if (url.pathname === `/api/v1/scripts/${scriptId}/versions/1`)
          return route.fulfill({ json: { document: { variables: [] } } });
        return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
      },
    );
    for (const state of ['empty', 'populated']) {
      if (state === 'empty') await page.goto(`/scripts/${scriptId}`);
      else {
        populated = true;
        await page.reload();
      }
      await expect(page.locator('.dw-script-header h1')).toBeVisible();
      const assignments = page.getByRole('link', {
        name: locale === 'tr' ? 'Kampanya atamaları' : 'Campaign assignments',
        exact: true,
      });
      const transport = page.getByRole('link', {
        name: locale === 'tr' ? 'Ortamlar arası taşıma' : 'Environment transport',
        exact: true,
      });
      await expect(assignments).toHaveAttribute('href', `/scripts/${scriptId}/assignments`);
      await expect(transport).toHaveAttribute('href', `/scripts/${scriptId}/packages`);
      if (state === 'empty') {
        await expect(page.locator('.dw-script-empty')).toBeVisible();
        await expect(page.locator('.dw-script-panel table')).toHaveCount(0);
      } else await expect(page.locator('.dw-script-panel table')).toBeVisible();
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => ({
            tag: el.tagName,
            className: el.className,
            width: el.getBoundingClientRect().width,
          })),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        JSON.stringify(overflow),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const heading = await page.locator('.dw-script-identity').boundingBox();
      const action = await page.locator('.dw-script-primary-actions').boundingBox();
      if (width === 1440) expect(heading!.x + heading!.width).toBeLessThan(action!.x);
      else expect(action!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
      await expect(page).toHaveScreenshot(
        `script-detail-${locale}-${theme}-${width}-${state}.png`,
        { fullPage: true },
      );
    }
  });
}
