import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  permissionFixture,
  scriptId,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

// DIFFERENTIATORS B2 / ADR-0050 (metadata-only): path replay of a real session.
test.use({ locale: 'en-US' });

const versionId = '01928f3a-0000-7000-8000-0000000000b1';
const sessionId = '01928f3a-0000-7000-8000-0000000000b2';

test('shows the path of a real session with redacted values, and passes axe', async ({ page }) => {
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
      localStorage.setItem('verbis.theme', 'light');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/permissions')
      ? { ...permissionFixture, rules: [...permissionFixture.rules, ['read', 'Session']] }
      : url.pathname === `/api/v1/scripts/${scriptId}/versions/1`
        ? { id: versionId }
        : url.pathname === '/api/v1/sessions'
          ? {
              data: [{ id: sessionId, state: 'completed', startedAt: '2026-10-07T10:00:00.000Z' }],
              page: { nextCursor: null },
            }
          : url.pathname === `/api/v1/sessions/${sessionId}/replay`
            ? {
                sessionId,
                scriptId,
                versionNumber: 1,
                state: 'completed',
                startedAt: '2026-10-07T10:00:00.000Z',
                durationMs: 75000,
                steps: [
                  { seq: 1, atMs: 0, kind: 'page', pageId: 'welcome', pageName: 'Welcome' },
                  { seq: 2, atMs: 4000, kind: 'field', variable: 'segment', value: '[REDACTED]' },
                  { seq: 3, atMs: 70000, kind: 'state', from: 'active', to: 'completed' },
                ],
                pages: [{ pageId: 'welcome', name: 'Welcome', visits: 1, dwellMs: 70000 }],
                unreached: [{ id: 'wrap', name: 'Wrap-up' }],
                truncated: false,
              }
            : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/scripts/${scriptId}/versions/1/replay`);
  await expect(page.getByRole('heading', { name: 'Session replay · version 1' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Session' }).click();
  await page.getByRole('option').first().click();
  await expect(page.getByText('Entered page Welcome')).toBeVisible();
  await expect(page.getByText('Set segment = [REDACTED]')).toBeVisible();
  await expect(page.getByText('Pages this session never reached: Wrap-up')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id),
  ).toEqual([]);
});
