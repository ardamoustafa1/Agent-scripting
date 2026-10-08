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

// DIFFERENTIATORS C2 / ADR-0051: suggestion mode in the editor.
test.use({ locale: 'en-US' });

const sent: { method: string; path: string; body: unknown }[] = [];
const listed = [
  {
    id: '01928f3a-0000-7000-8000-0000000000a2',
    scriptId,
    versionNumber: 1,
    title: 'Reword the button',
    note: null,
    operations: [
      { op: 'replace', path: '/pages/0/layout/children/0/props/labelKey', value: 'common.next' },
    ],
    state: 'open',
    createdAt: '2026-10-07T10:00:00.000Z',
    createdBy: 'user:reviewer',
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
  },
];
async function open(page: Page) {
  sent.length = 0;
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', 'light');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method !== 'GET')
      sent.push({ method, path: url.pathname, body: request.postDataJSON() as unknown });
    const body = url.pathname.endsWith('/versions/1')
      ? editorFixture()
      : url.pathname.endsWith('/suggestions')
        ? method === 'POST'
          ? {
              id: '01928f3a-0000-7000-8000-0000000000a1',
              scriptId,
              versionNumber: 1,
              title: 'Rename',
              note: null,
              operations: [],
              state: 'open',
              createdAt: '2026-10-07T10:00:00.000Z',
              createdBy: 'user:me',
              decidedAt: null,
              decidedBy: null,
              decisionReason: null,
            }
          : listed
        : url.pathname.endsWith('/permissions')
          ? {
              ...permissionFixture,
              rules: [...permissionFixture.rules, ['read', 'Script'], ['update', 'Script']],
            }
          : method === 'PUT'
            ? { version: 2 }
            : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: method === 'POST' ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/edit`);
  await expect(page.locator('.ed-palette-item').first()).toBeVisible();
}

test('proposes a change without saving the draft, and the dialog is accessible', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Suggest changes', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Suggestion mode' })).toBeVisible();
  // Edit through the real UI: rename the first page.
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  await page.getByLabel('Rename selected page', { exact: true }).fill('Renamed in suggestion mode');
  // Autosave is off: wait past the 800 ms debounce and make sure nothing was written.
  await page.waitForTimeout(1500);
  expect(sent.filter((request) => request.method === 'PUT')).toEqual([]);

  await page.getByRole('button', { name: 'Propose changes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose changes' });
  await expect(dialog).toBeVisible();
  const send = dialog.getByRole('button', { name: 'Send suggestion', exact: true });
  await expect(send).toBeDisabled();
  await dialog.getByLabel('Title', { exact: true }).fill('Clearer page name');
  await expect(send).toBeEnabled();
  // Axe measures contrast, so let the dialog's enter animation finish first.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.map(
      (violation) => violation.id,
    ),
  ).toEqual([]);
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: 'Suggestion sent' })).toBeVisible();

  const post = sent.find((request) => request.method === 'POST');
  expect(post?.path).toBe(`/api/v1/scripts/${scriptId}/versions/1/suggestions`);
  expect(post?.body).toMatchObject({
    title: 'Clearer page name',
    operations: [{ op: 'replace', path: '/pages/0/name', value: 'Renamed in suggestion mode' }],
  });
  expect(sent.filter((request) => request.method === 'PUT')).toEqual([]);
  // The editor is back on the saved draft.
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  await expect(page.getByLabel('Rename selected page', { exact: true })).not.toHaveValue(
    'Renamed in suggestion mode',
  );
});

test('discarding restores the saved draft and offers suggestion mode again', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Suggest changes', exact: true }).click();
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  const name = page.getByLabel('Rename selected page', { exact: true });
  const original = await name.inputValue();
  await name.fill('Throwaway');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Suggest changes', exact: true })).toBeVisible();
  await expect(name).toHaveValue(original);
  expect(sent.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('shows an open suggestion on the canvas from the review panel', async ({ page }) => {
  await open(page);
  await page
    .getByRole('button', { name: /Join collaborative editing|Team and comments/ })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Suggestions' });
  await expect(panel.getByText('Reword the button')).toBeVisible();
  await panel.getByRole('button', { name: 'Show on canvas', exact: true }).click();
  await expect(page.getByText('Suggested change')).toBeVisible();
  await panel.getByRole('button', { name: 'Hide from canvas', exact: true }).click();
  await expect(page.getByText('Suggested change')).toHaveCount(0);
});
