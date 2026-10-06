import { test, expect } from '@playwright/test';
for (const [locale, search] of [
  ['tr', 'Ara'],
  ['en', 'Search'],
] as const)
  test(`${locale} documentation navigation and search`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/${locale}/`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('h1')).toBeVisible();
    await page.getByRole('button', { name: search, exact: true }).click();
    const input = page.getByRole('dialog').getByRole('textbox');
    await expect(input).toBeVisible();
    await input.fill('script');
    const result = page.locator('.pagefind-ui__result-link').first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.locator('h1')).toBeVisible();
    expect(errors).toEqual([]);
  });

for (const locale of ['tr', 'en'])
  test(`${locale} documentation theme and language controls`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    const theme = page.locator('starlight-theme-select select').filter({ visible: true }).first();
    await theme.selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await theme.selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const next = locale === 'tr' ? 'en' : 'tr';
    await page
      .locator('starlight-lang-select select')
      .filter({ visible: true })
      .first()
      .selectOption(`/${next}/`);
    await expect(page.locator('html')).toHaveAttribute('lang', next);
  });
