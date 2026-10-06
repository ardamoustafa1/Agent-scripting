/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  campaignFixture,
  campaignId,
  fixtureResponse,
  pageFixture,
  permissionFixture,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

for (const locale of ['en', 'tr'] as const) {
  for (const width of [390, 1440]) {
    test(`campaign-scoped creation and explanatory 403 ${locale} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        ({ locale, tenant, user }) => {
          localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
          Object.defineProperty(navigator, 'languages', { get: () => [locale] });
        },
        { locale, tenant: tenantId, user: sessionFixture.user.id },
      );
      let posts = 0;
      await page.route('**/api/**', async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (url.pathname.endsWith('/permissions'))
          return route.fulfill({
            json: {
              ...permissionFixture,
              rules: [
                ['read', 'Tenant'],
                ['read', 'Script', { campaignIds: { $in: [campaignId] } }],
                ['create', 'Script', { campaignIds: { $in: [campaignId] } }],
                ['read', 'Campaign', { id: { $in: [campaignId] } }],
              ],
            },
          });
        if (url.pathname === '/api/v1/campaigns')
          return route.fulfill({
            json: pageFixture([
              campaignFixture,
              {
                ...campaignFixture,
                id: '01928f3a-0000-7000-8000-000000000099',
                name: 'Outside scope',
              },
            ]),
          });
        if (req.method() === 'POST' && url.pathname === '/api/v1/scripts') {
          posts++;
          expect(req.postDataJSON()).toMatchObject({ name: 'Synthetic scoped script', campaignId });
          expect(req.headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
          expect(req.headers()['idempotency-key']).toBeTruthy();
          return route.fulfill({
            status: 403,
            contentType: 'application/problem+json',
            json: { code: 'VERBIS_AUTHZ_SCOPE_MISSING' },
          });
        }
        return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
      });
      await page.goto('/scripts');
      await page
        .getByRole('button', { name: locale === 'en' ? 'New script' : 'Yeni script', exact: true })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByLabel(locale === 'en' ? 'Name' : 'Ad', { exact: true })
        .fill('Synthetic scoped script');
      const create = dialog.getByRole('button', {
        name: locale === 'en' ? 'Create' : 'Oluştur',
        exact: true,
      });
      await expect(create).toBeDisabled();
      expect(posts).toBe(0);
      const campaign = dialog.getByRole('combobox', {
        name: locale === 'en' ? 'Campaign' : 'Kampanya',
        exact: true,
      });
      await expect(campaign).toBeEnabled();
      await expect(page.getByRole('option', { name: 'Outside scope' })).toHaveCount(0);
      await campaign.selectOption({ label: campaignFixture.name });
      await expect(create).toBeEnabled();
      await create.click();
      await expect(
        dialog.getByText(
          locale === 'en'
            ? 'This script has no campaign assignment. Choose a campaign within your scope, or ask an administrator to assign the script.'
            : 'Bu scriptin kampanya ataması yok. Yetki kapsamınızdaki bir kampanyayı seçin veya yöneticinizden scripti atamasını isteyin.',
          { exact: true },
        ),
      ).toBeVisible();
      expect(posts).toBe(1);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
