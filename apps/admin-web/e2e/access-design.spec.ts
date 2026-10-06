/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';

test.use({ locale: 'tr-TR' });
for (const width of [320, 768, 1440]) {
  test(`shared access ${width}: TR/EN, motion and preserved authentication input`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const privileged: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/')) privileged.push(request.url());
    });
    await page.route('**/api/auth/session/status', (route) =>
      route.fulfill({ json: { authenticated: false } }),
    );
    await page.goto('/');
    const input = page.getByLabel('İş e-postası', { exact: true });
    await input.fill('user@verbis.test');
    await expect(page.locator('.vb-access')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Animasyonu durdur' }).click();
    await expect(page.getByRole('main')).toHaveAttribute('data-motion', 'paused');
    await page.screenshot({
      path: test.info().outputPath(`admin-access-tr-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Switch to English' }).click();
    await expect(page.locator('input').first()).toHaveValue('user@verbis.test');
    await page.getByRole('button', { name: 'Play animation' }).click();
    await expect(page.getByRole('main')).toHaveAttribute('data-motion', 'running');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(privileged).toEqual([]);
  });
}
