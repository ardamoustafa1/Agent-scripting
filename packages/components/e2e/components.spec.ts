import { AxeBuilder } from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

import { LIBRARY_DEFINITIONS } from '../src/catalog.js';

for (const definition of LIBRARY_DEFINITIONS)
  for (const theme of ['light', 'dark', 'high-contrast']) {
    test(`${definition.type} / ${theme} / axe + keyboard`, async ({ page }) => {
      await page.goto(
        `/iframe.html?id=components-${definition.displayName.toLowerCase()}--default&viewMode=story&globals=theme:${theme};locale:tr`,
      );
      await page.locator('.vc-story').waitFor();
      await expect(page.getByText('Bu bileşen gösterilemedi')).toHaveCount(0);
      const result = await new AxeBuilder({ page }).include('.vc-story').analyze();
      expect(result.violations).toEqual([]);
      await page.keyboard.press('Tab');
      const focused = page.locator(':focus');
      if (await focused.count()) await expect(focused).toBeVisible();
    });
  }
test('TR/EN catalogs and RTL layout can render forms', async ({ page }) => {
  await page.goto('/iframe.html?id=components-textinput--default&globals=locale:en;direction:rtl');
  await page.locator('.vc-story').waitFor();
  await expect(page.getByRole('textbox', { name: 'Field' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
