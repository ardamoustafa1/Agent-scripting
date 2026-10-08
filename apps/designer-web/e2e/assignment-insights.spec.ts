/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  campaignId,
  fixtureResponse,
  permissionFixture,
  scriptId,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

const assignmentId = '01928f3a-0000-7000-8000-000000000005';
const otherId = '01928f3a-0000-7000-8000-000000000006';
const row = (id: string, priority: number) => ({
  id,
  scriptId,
  campaignId,
  version: 1,
  priority,
  effectiveFrom: null,
  effectiveTo: null,
  expression: null,
  variants: [
    { key: 'a', weight: 5000 },
    { key: 'b', weight: 5000 },
  ],
});
const cases = ['light', 'dark', 'high-contrast'].flatMap((theme) =>
  [320, 1440].map((width) => ({ theme, width })),
);
for (const { theme, width } of cases) {
  test(`experiment evidence and conflicts are accessible ${theme} ${String(width)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      ({ theme, tenant, user }) => {
        localStorage.setItem('verbis.theme', theme);
        localStorage.setItem(`verbis.tour.${tenant}.${user}`, 'done');
        Object.defineProperty(navigator, 'languages', { get: () => ['en'] });
      },
      { theme, tenant: tenantId, user: sessionFixture.user.id },
    );
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        let body: unknown;
        if (path.endsWith('/permissions'))
          body = {
            ...permissionFixture,
            rules: [...permissionFixture.rules, ['update', 'Campaign']],
          };
        else if (path.startsWith('/api/v1/assignments/') && path.endsWith('/allocation'))
          body = {
            assignmentId,
            allocation: {
              reason: 'ok',
              arms: [
                { key: 'a', probabilityBest: 0.12, weight: 5000 },
                { key: 'b', probabilityBest: 0.88, weight: 5000 },
              ],
            },
          };
        else if (path.startsWith('/api/v1/assignments/') && path.endsWith('/rollout'))
          body = {
            assignmentId,
            stableSessions: 300,
            canarySessions: 90,
            windowDays: 7,
            decision: {
              action: 'advance',
              reason: 'no-harm-detected',
              breached: [],
              from: 1000,
              to: 5000,
              proposal: [
                { key: 'a', weight: 5000 },
                { key: 'b', weight: 5000 },
              ],
            },
          };
        else if (path.endsWith('/assignment-conflicts'))
          body = [
            {
              assignmentIds: [assignmentId, otherId],
              priority: 10,
              severity: 'certain',
              resolvedBy: 'id',
              overlap: { 'interaction.channel': ['voice', 'chat'] },
            },
          ];
        else if (path === '/api/v1/assignments')
          body = {
            data: [row(assignmentId, 10), row(otherId, 10)],
            page: { nextCursor: null, limit: 100, sort: 'priority' },
          };
        else body = fixtureResponse(path + url.search);
        return route.fulfill({ json: body });
      },
    );
    await page.goto(`/scripts/${scriptId}/assignments`);
    await page.getByRole('combobox', { name: 'Campaign to reorder' }).click();
    await page.getByRole('option').nth(1).click();
    await expect(page.getByText('Certain overlap')).toBeVisible();
    await page.getByRole('button', { name: 'Apply', exact: true }).first().click();
    await expect(page.getByText('How is this experiment doing?')).toBeVisible();
    await expect(page.getByText('88%')).toBeVisible();
    await expect(page.getByText('Safe to advance')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
