import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark', 'high-contrast'])
  for (const locale of ['tr', 'en'])
    test(`analytics ${theme} ${locale}: keyboard, axe and visual regression`, async ({ page }) => {
      await page.goto(
        `/iframe.html?id=analytics-dashboard--populated&viewMode=story&globals=theme:${theme};locale:${locale}`,
      );
      await expect(page.locator('.vb-analytics')).toBeVisible();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
      const result = await new AxeBuilder({ page }).include('.vb-analytics').analyze();
      expect(result.violations).toEqual([]);
      // Native date inputs select different segments across Chromium/OS versions.
      // Keyboard focus is verified above; blur before the visual reference.
      await page.locator('.vb-analytics h1').click();
      await expect(page.locator('.vb-analytics')).toHaveScreenshot(
        `analytics-${theme}-${locale}.png`,
        { animations: 'disabled' },
      );
    });
