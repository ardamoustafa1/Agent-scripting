import { AxeBuilder } from '@axe-core/playwright';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  scriptId,
  sessionFixture,
  tenantId,
  permissionFixture,
} from '../src/test-fixtures.js';

// ADR-0052: conversation triggers authored without JSON, tried with the call's own matcher.
test.use({ locale: 'en-US' });

async function open(page: Page, theme: string) {
  await page.addInitScript(
    ({ tenant, user, value }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', value);
    },
    { tenant: tenantId, user: sessionFixture.user.id, value: theme },
  );
  const saved: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PUT') saved.push(route.request().postDataJSON());
    const body = url.pathname.endsWith('/versions/1')
      ? editorFixture()
      : url.pathname.endsWith('/permissions')
        ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
        : route.request().method() === 'PUT'
          ? { version: 2 }
          : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
  await page.locator('.ed-mode-shortcuts').getByRole('button', { name: 'Triggers' }).click();
  await expect(page.getByRole('heading', { name: 'Conversation triggers' })).toBeVisible();
  return saved;
}

const axe = (page: Page) =>
  new AxeBuilder({ page })
    .include('.fd-manager')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);

test('creates a trigger, writes its phrases and hint, and tries a sentence', async ({ page }) => {
  await open(page, 'light');
  await page.getByRole('button', { name: 'Add trigger' }).click();
  await page.getByRole('textbox', { name: 'Phrases (TR)' }).fill('iptal etmek\naboneliğimi kapat');
  await page
    .getByRole('textbox', { name: 'Hint text (TR)' })
    .fill('Önce sadakat indirimini önerin.');
  await page.getByRole('textbox', { name: 'Sentence' }).fill('Aboneliğimi İPTAL ETMEK istiyorum');
  await expect(page.getByText('“Trigger 1” fires (heard “iptal etmek”).')).toBeVisible();
  await page.getByRole('textbox', { name: 'Sentence' }).fill('Faturam yüksek geldi');
  await expect(page.getByText('No trigger would fire.')).toBeVisible();
});

for (const theme of ['light', 'dark', 'high-contrast'])
  test(`triggers editor has no axe violations in the ${theme} theme`, async ({ page }) => {
    await open(page, theme);
    await expect(page.getByText('No triggers yet')).toBeVisible();
    expect((await axe(page).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Add trigger' }).click();
    await page.getByRole('textbox', { name: 'Sentence' }).fill('iptal');
    await expect(page.getByRole('textbox', { name: 'Phrases (TR)' })).toBeVisible();
    expect((await axe(page).analyze()).violations).toEqual([]);
  });

test('the editor keyboard path reaches every trigger control', async ({ page }) => {
  await open(page, 'light');
  await page.getByRole('button', { name: 'Add trigger' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.focus();
  const reached = new Set<string>();
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab');
    reached.add(
      await page.evaluate(() => {
        const focused = document.activeElement;
        return focused?.getAttribute('aria-label') ?? focused?.textContent.trim() ?? '';
      }),
    );
  }
  expect([...reached].some((label) => label.includes('Add action'))).toBe(true);
  expect([...reached].some((label) => label.includes('Delete trigger'))).toBe(true);
});
