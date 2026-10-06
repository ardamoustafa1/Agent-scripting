import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const locale of ['tr', 'en'])
  for (const width of [320, 1440])
    for (const theme of ['light', 'dark']) {
      test(`documentation identity ${locale}/${width}/${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((value) => localStorage.setItem('starlight-theme', value), theme);
        const response = await page.goto(`/${locale}/designer/first-script/`);
        expect(response?.status()).toBe(200);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({
          path: test.info().outputPath(`docs-${locale}-${width}-${theme}.png`),
          fullPage: true,
        });
      });
    }
