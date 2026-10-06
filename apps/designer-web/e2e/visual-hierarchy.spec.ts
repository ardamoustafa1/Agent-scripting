/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import { fixtureResponse, sessionFixture, tenantId } from '../src/test-fixtures.js';

for (const theme of ['light', 'dark', 'high-contrast']) {
  for (const width of [320, 768, 1440]) {
    test(`library hierarchy ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        ({ theme, tenant, user }) => {
          localStorage.setItem('verbis.theme', theme);
          localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
          Object.defineProperty(navigator, 'languages', { get: () => ['tr'] });
        },
        { theme, tenant: tenantId, user: sessionFixture.user.id },
      );
      await page.route(
        (url) => url.pathname.startsWith('/api/'),
        (route) => {
          const url = new URL(route.request().url());
          return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
        },
      );
      await page.goto('/scripts');
      const heading = page.locator('.dw-library .dw-page-heading');
      await expect(heading).toBeVisible();
      expect(await heading.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const box = await heading.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(width);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `../../artifacts/visual-hierarchy-20261005/library-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
