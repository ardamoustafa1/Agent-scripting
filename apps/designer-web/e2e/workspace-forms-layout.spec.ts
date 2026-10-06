/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  campaignId,
  fixtureResponse,
  permissionFixture,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

for (const theme of ['light', 'dark', 'high-contrast']) {
  for (const width of [390, 768, 1440]) {
    test(`workspace forms fit and actions keep their hierarchy ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        ({ theme, tenant, user }) => {
          localStorage.setItem('verbis.theme', theme);
          localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
          Object.defineProperty(navigator, 'languages', { get: () => ['en'] });
        },
        { theme, tenant: tenantId, user: sessionFixture.user.id },
      );
      await page.route(
        (url) => url.pathname.startsWith('/api/'),
        (route) => {
          const url = new URL(route.request().url());
          const body = url.pathname.endsWith('/permissions')
            ? {
                ...permissionFixture,
                rules: [
                  ...permissionFixture.rules,
                  ['update', 'Campaign'],
                  ['create', 'Integration'],
                ],
              }
            : fixtureResponse(url.pathname + url.search);
          return route.fulfill({ json: body });
        },
      );
      await page.goto(`/campaigns/${campaignId}`);
      if (width < 1100) {
        await expect(
          page.getByRole('heading', { name: 'Demo campaign', exact: true }),
        ).toBeVisible();
        expect(
          await page
            .locator('.dw-nav span')
            .first()
            .evaluate((element) => getComputedStyle(element).display),
        ).toBe('none');
      }
      const form = page.locator('.dw-campaign-settings > fieldset');
      await expect(form).toBeVisible();
      expect(await form.evaluate((element) => getComputedStyle(element).display)).toBe('grid');
      if (width === 1440) {
        const status = await form
          .getByRole('combobox', { name: 'Status', exact: true })
          .boundingBox();
        const channels = await form
          .getByRole('button', { name: 'Channels', exact: true })
          .boundingBox();
        expect(Math.abs(status!.y - channels!.y)).toBeLessThan(5);
      }
      await page.getByRole('button', { name: 'Add outcome', exact: true }).click();
      expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.goto('/integrations/new');
      await page.getByRole('tab', { name: 'Mocks', exact: true }).click();
      const add = page.getByRole('button', { name: 'Add scenario', exact: true });
      await expect(add).toBeVisible();
      expect(await add.evaluate((element) => getComputedStyle(element).alignSelf)).toBe(
        'flex-start',
      );
      await page.getByRole('tab', { name: 'Resilience', exact: true }).click();
      const panel = page.locator('.ig-editor .vb-tab-content > fieldset');
      expect(await panel.evaluate((element) => getComputedStyle(element).display)).toBe('grid');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      for (const name of [
        'Import',
        'Request',
        'Schema / PII',
        'Mapping',
        'Resilience',
        'Mocks',
        'Test console',
        'Profiles / approvals',
      ]) {
        await page.getByRole('tab', { name, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const activePanel = page.getByRole('tabpanel');
        expect(
          await activePanel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
      await page.goto('/settings');
      const badge = page.locator('.dw-detail-summary .vb-badge');
      await expect(badge).toBeVisible();
      expect(await badge.evaluate((element) => getComputedStyle(element).alignSelf)).toBe(
        'flex-start',
      );
    });
  }
}
