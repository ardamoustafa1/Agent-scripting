/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  tenantId,
  sessionFixture,
  permissionFixture,
} from '../src/test-fixtures.js';

import { analyticsFixture } from './analytics-fixture.js';

test.use({ locale: 'tr-TR' });

for (const locale of ['tr', 'en']) {
  test.describe(`insights ${locale}`, () => {
    test.use({ locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    for (const theme of ['light', 'dark', 'high-contrast']) {
      for (const width of [320, 768, 1440]) {
        test(`${theme} ${width}: empty and populated design retain report tools`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 1000 });
          await page.addInitScript(
            ({ theme, tenant, user }) => {
              localStorage.setItem('verbis.theme', theme);
              localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
            },
            { theme, tenant: tenantId, user: sessionFixture.user.id },
          );
          let populated = false;
          await page.route(
            (url) => url.pathname.startsWith('/api/'),
            (route) => {
              const url = new URL(route.request().url());
              if (url.pathname === '/api/v1/me/permissions')
                return route.fulfill({
                  json: {
                    ...permissionFixture,
                    rules: [
                      ...permissionFixture.rules,
                      ['read', 'Report'],
                      ['export', 'Report'],
                      ['manage', 'Report'],
                    ],
                  },
                });
              const data =
                url.pathname === '/api/v1/analytics/schedules'
                  ? []
                  : url.pathname === '/api/v1/analytics/dashboard'
                    ? populated
                      ? analyticsFixture
                      : {
                          ...analyticsFixture,
                          sessions: 0,
                          completed: 0,
                          sampleEvents: 0,
                          scripts: [],
                          agents: [],
                          pages: [],
                          paths: [],
                          outcomes: [],
                          sources: [],
                          heatmap: [],
                          variants: [],
                          comparisons: [],
                          active: [],
                          liveCampaigns: [],
                          completionRate: 0,
                          meanDurationMs: null,
                          compliance: { eligible: 0, acknowledged: 0, rate: null },
                        }
                    : fixtureResponse(url.pathname + url.search);
              return route.fulfill({ json: data });
            },
          );
          await page.goto('/analytics');
          await expect(page.locator('.vb-analytics h1')).toHaveText(
            locale === 'tr' ? 'Operasyonun nabzı' : 'Operational pulse',
          );
          await expect(page.locator('.vb-analytics-empty h2')).toBeVisible();
          await expect(page.locator('.vb-analytics-metric')).toHaveCount(4);
          await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: 'XLSX', exact: true })).toBeVisible();
          await expect(page.locator('.vb-analytics-schedule')).toBeVisible();
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(page).toHaveScreenshot(`insights-${locale}-${theme}-${width}-empty.png`, {
            fullPage: true,
          });
          populated = true;
          await page.reload();
          await expect(page.locator('.vb-analytics-grid')).toBeVisible();
          await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled();
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(page).toHaveScreenshot(
            `insights-${locale}-${theme}-${width}-populated.png`,
            { fullPage: true },
          );
        });
      }
    }
  });
}

test('all workspace commands and report operations remain usable', async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  const scheduleId = '01990000-0000-7000-8000-000000000088';
  let saved = false;
  const writes: { method: string; body: unknown; csrf: string | undefined }[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname === '/api/v1/me/permissions')
        return route.fulfill({
          json: {
            ...permissionFixture,
            rules: [
              ...permissionFixture.rules,
              ['read', 'Report'],
              ['export', 'Report'],
              ['manage', 'Report'],
            ],
          },
        });
      if (url.pathname.includes('/analytics/export/'))
        return route.fulfill({ body: 'synthetic report', contentType: 'application/octet-stream' });
      if (url.pathname === '/api/v1/analytics/dashboard')
        return route.fulfill({ json: analyticsFixture });
      if (url.pathname.startsWith('/api/v1/analytics/schedules')) {
        if (req.method() === 'POST' || req.method() === 'DELETE') {
          writes.push({
            method: req.method(),
            body: req.method() === 'POST' ? (req.postDataJSON() as unknown) : null,
            csrf: req.headers()['x-csrf-token'],
          });
          saved = req.method() === 'POST';
          return route.fulfill({
            json: saved ? { id: scheduleId, nextRunAt: '2026-10-06T08:00:00Z' } : { deleted: true },
          });
        }
        return route.fulfill({
          json: saved ? [{ id: scheduleId, version: 1, next_run_at: '2026-10-06T08:00:00Z' }] : [],
        });
      }
      return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
    },
  );
  await page.goto('/analytics');
  await expect(page.locator('.vb-analytics-grid')).toBeVisible();
  for (const format of ['CSV', 'XLSX']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`verbis-analytics.${format.toLowerCase()}`);
  }
  await page.getByRole('combobox', { name: 'Kanal', exact: true }).selectOption('voice');
  await page.getByRole('button', { name: 'Filtreleri temizle', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Kanal', exact: true })).toHaveValue('');
  await page.getByLabel('Alıcı kullanıcı kimlikleri').fill(scheduleId);
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.getByText('Rapor planı kaydedildi.', { exact: true })).toBeVisible();
  await expect(page.locator('.vb-analytics-delivery')).toBeVisible();
  await page.getByRole('button', { name: 'Kaldır', exact: true }).click();
  await expect(page.locator('.vb-analytics-delivery')).toHaveCount(0);
  expect(writes).toEqual([
    {
      method: 'POST',
      body: expect.objectContaining({
        recipientUserIds: [scheduleId],
        hourUtc: 8,
        frequency: 'weekly',
        enabled: true,
      }),
      csrf: 'synthetic-csrf-only',
    },
    { method: 'DELETE', body: null, csrf: 'synthetic-csrf-only' },
  ]);
  await page.getByRole('button', { name: 'Organizasyon', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Ortam', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Geliştirme', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Her yerde ara/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Bildirimler', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Kullanıcı menüsü', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Oturumu kapat' })).toBeVisible();
});
