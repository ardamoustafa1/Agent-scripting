/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import { fixtureResponse } from '../src/test-fixtures.js';

for (const locale of ['tr', 'en']) {
  test.describe(`welcome guide ${locale}`, () => {
    test.use({ locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    for (const theme of ['light', 'dark', 'high-contrast']) {
      for (const width of [320, 1440]) {
        test(`${theme} ${width}: all steps, keyboard, restart and axe`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.addInitScript((value) => {
            localStorage.setItem('verbis.theme', value);
          }, theme);
          await page.route(
            (url) => url.pathname.startsWith('/api/'),
            (route) => {
              const url = new URL(route.request().url());
              return route.fulfill({ json: fixtureResponse(url.pathname + url.search) });
            },
          );
          await page.goto('/settings');
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          const next = locale === 'tr' ? 'İleri' : 'Next';
          const back = locale === 'tr' ? 'Geri' : 'Back';
          await expect(dialog.getByRole('button', { name: back })).toBeDisabled();
          for (let step = 1; step <= 3; step++) {
            await expect(dialog.locator('.dw-tour-progress')).toHaveText(`${step} / 3`);
            await expect(dialog).not.toContainText('{current}');
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
            expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
              true,
            );
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true);
            await expect(dialog).toHaveScreenshot(
              `welcome-${locale}-${theme}-${width}-step-${step}.png`,
            );
            if (step === 1) {
              await dialog.getByRole('button', { name: next, exact: true }).click();
              await dialog.getByRole('button', { name: back, exact: true }).click();
              await expect(dialog.locator('.dw-tour-progress')).toHaveText('1 / 3');
            }
            if (step < 3) await dialog.getByRole('button', { name: next, exact: true }).click();
          }
          const start = dialog.getByRole('button', {
            name: locale === 'tr' ? 'Başlayalım' : 'Get started',
            exact: true,
          });
          await start.focus();
          await page.keyboard.press('Enter');
          await expect(dialog).toHaveCount(0);
          await page.reload();
          await expect(page.locator('.dw-topbar')).toBeVisible();
          await expect(dialog).toHaveCount(0);
          await page
            .getByRole('button', { name: locale === 'tr' ? 'Yardım' : 'Help', exact: true })
            .click();
          await expect(dialog.locator('.dw-tour-progress')).toHaveText('1 / 3');
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByRole('button', { name: locale === 'tr' ? 'Yardım' : 'Help', exact: true }),
          ).toBeFocused();
        });
      }
    }
  });
}
