import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ status: 401, body: '{}' }));
});
test('requires SSO and ignores arbitrary script launch parameters', async ({ page }) => {
  const redeem: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/launch/redeem')) redeem.push(request.url());
  });
  await page.goto('/?scriptId=untrusted&campaignId=untrusted');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show SSO providers' })).toBeDisabled();
  expect(redeem).toEqual([]);
});
for (const theme of ['light', 'dark', 'high-contrast']) {
  test(`SSO accessibility (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(report.violations).toEqual([]);
  });
}
