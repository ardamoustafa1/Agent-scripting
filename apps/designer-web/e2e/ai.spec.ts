import { AxeBuilder } from '@axe-core/playwright';

import { test, expect } from '../../../tests/playwright/test.js';
import { editorFixture } from '../src/editor/fixtures.js';
import {
  fixtureResponse,
  sessionFixture,
  permissionFixture,
  tenantId,
} from '../src/test-fixtures.js';

test.use({ locale: 'en-US' });
test('AI suggestions do not save or publish until a human approves', async ({ page }) => {
  let writes = 0;
  await page.addInitScript(
    ({ tenant, user }) => {
      localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
    },
    { tenant: tenantId, user: sessionFixture.user.id },
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith('/permissions'))
      body = { ...permissionFixture, rules: [...permissionFixture.rules, ['create', 'Script']] };
    else if (url.pathname.endsWith('/ai/status')) body = { enabled: true, agentEnabled: false };
    else if (url.pathname.endsWith('/ai/suggestions')) {
      expect(route.request().headers()['x-csrf-token']).toBe(sessionFixture.csrfToken);
      body = {
        callId: '00000000-0000-7000-8000-000000000011',
        task: 'draft',
        requiresHumanApproval: true,
        value: editorFixture().document,
        inputTokens: 100,
        outputTokens: 40,
        maskedCount: 1,
      };
    } else {
      if (route.request().method() !== 'GET') writes++;
      body = fixtureResponse(url.pathname + url.search);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/ai');
  await page.getByLabel('Source text', { exact: true }).fill('Synthetic service greeting');
  await page.getByRole('button', { name: 'Generate suggestion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review suggestion', exact: true })).toBeVisible();
  expect(writes).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
