import { AxeBuilder } from '@axe-core/playwright';

import { expect, test, type Page } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  permissionFixture,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

// ADR-0057: knowledge articles written, previewed and published in the designer.
test.use({ locale: 'en-US' });

const ID = '01928f3a-0000-7000-8000-0000000000cc';
const article = (over: Record<string, unknown> = {}) => ({
  id: ID,
  key: 'refund-policy',
  title: 'Refund policy',
  body: 'Refunds are made within 14 days.\n\n## Steps\n1. Verify the customer\n2. Record the request',
  tags: ['refund'],
  locale: 'en',
  status: 'draft',
  publishedAt: null,
  createdAt: '2026-10-22T10:00:00.000Z',
  createdBy: `user:${sessionFixture.user.id}`,
  updatedAt: '2026-10-22T10:00:00.000Z',
  updatedBy: `user:${sessionFixture.user.id}`,
  version: 1,
  ...over,
});

async function open(page: Page, theme: string, path: string) {
  await page.addInitScript(
    ({ tenant, user, value }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', value);
    },
    { tenant: tenantId, user: sessionFixture.user.id, value: theme },
  );
  const sent: { method: string; path: string; body: unknown; ifMatch: string | null }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const method = request.method();
    if (method !== 'GET')
      sent.push({
        method,
        path: url.pathname,
        body: request.postDataJSON() as unknown,
        ifMatch: request.headers()['if-match'] ?? null,
      });
    const body = url.pathname.endsWith('/permissions')
      ? {
          ...permissionFixture,
          rules: [
            ...permissionFixture.rules,
            ['read', 'KnowledgeArticle'],
            ['create', 'KnowledgeArticle'],
            ['update', 'KnowledgeArticle'],
            ['publish', 'KnowledgeArticle'],
          ],
        }
      : url.pathname === '/api/v1/knowledge-articles' && method === 'GET'
        ? { data: [article({ status: 'published' })], page: { nextCursor: null, limit: 50 } }
        : url.pathname === `/api/v1/knowledge-articles/${ID}/publish`
          ? article({ status: 'published', version: 2, publishedAt: '2026-10-22T11:00:00.000Z' })
          : url.pathname === `/api/v1/knowledge-articles/${ID}`
            ? article()
            : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  return sent;
}

const axe = (page: Page) =>
  new AxeBuilder({ page })
    .include('.kb-stack')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);

test('lists articles from the workspace rail and opens one', async ({ page }) => {
  await open(page, 'light', '/');
  await page.getByRole('link', { name: 'Knowledge base' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge base' })).toBeVisible();
  await page.getByRole('link', { name: 'Refund policy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Refund policy' })).toBeVisible();
});

test('previews the article as agents see it and publishes the saved text', async ({ page }) => {
  const sent = await open(page, 'light', `/knowledge/${ID}`);
  const preview = page.getByRole('region', { name: 'What agents will see' });
  await expect(preview.getByRole('heading', { level: 4, name: 'Steps' })).toBeVisible();
  await expect(preview.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  expect(sent).toEqual([
    {
      method: 'POST',
      path: `/api/v1/knowledge-articles/${ID}/publish`,
      body: null,
      ifMatch: '"1"',
    },
  ]);
});

for (const theme of ['light', 'dark', 'high-contrast'])
  test(`knowledge pages have no axe violations in the ${theme} theme`, async ({ page }) => {
    await open(page, theme, '/knowledge');
    await expect(page.getByRole('link', { name: 'Refund policy' })).toBeVisible();
    expect((await axe(page).analyze()).violations).toEqual([]);
    await page.goto(`/knowledge/${ID}`);
    await expect(page.getByRole('textbox', { name: 'Article text' })).toBeVisible();
    expect((await axe(page).analyze()).violations).toEqual([]);
  });

test('the article editor is usable with the keyboard alone', async ({ page }) => {
  await open(page, 'light', `/knowledge/${ID}`);
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.focus();
  const reached = new Set<string>();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    reached.add(
      await page.evaluate(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return '';
        const labelled =
          focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
            ? focused.labels?.[0]?.textContent
            : undefined;
        return (focused.getAttribute('aria-label') ?? labelled ?? focused.textContent).trim();
      }),
    );
  }
  expect([...reached].some((label) => label.startsWith('Article text'))).toBe(true);
});
