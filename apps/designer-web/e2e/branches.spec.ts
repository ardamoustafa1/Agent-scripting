import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from '../../../tests/playwright/test.js';
import {
  fixtureResponse,
  permissionFixture,
  scriptId,
  sessionFixture,
  tenantId,
} from '../src/test-fixtures.js';

// DIFFERENTIATORS C3 / ADR-0051: branches on the script page.
test.use({ locale: 'en-US' });

const sent: { method: string; path: string; body: unknown }[] = [];
test('creates a branch and merges only after a side is chosen for each conflict', async ({
  page,
}) => {
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
    const branches = `/api/v1/scripts/${scriptId}/branches`;
    const body = url.pathname.endsWith('/permissions')
      ? { ...permissionFixture, rules: [...permissionFixture.rules, ['update', 'Script']] }
      : url.pathname === branches
        ? method === 'POST'
          ? {
              name: 'november',
              versionNumber: 2,
              parentNumber: 1,
              state: 'draft',
              createdAt: '2026-10-07T10:00:00.000Z',
              createdBy: 'user:me',
              mergedInto: null,
            }
          : [
              {
                name: 'redesign',
                versionNumber: 3,
                parentNumber: 1,
                state: 'draft',
                createdAt: '2026-10-07T10:00:00.000Z',
                createdBy: 'user:me',
                mergedInto: null,
              },
            ]
        : url.pathname === `${branches}/redesign/merge-preview`
          ? {
              branch: 'redesign',
              baseNumber: 1,
              mainlineNumber: 2,
              branchNumber: 3,
              conflicts: [
                {
                  path: '/pages/home/name',
                  kind: 'both-changed',
                  base: '"Home"',
                  ours: '"Mainline name"',
                  theirs: '"Branch name"',
                },
              ],
              issues: [],
              canMerge: true,
            }
          : fixtureResponse(url.pathname + url.search);
    await route.fulfill({
      status: method === 'POST' ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/scripts/${scriptId}`);
  const panel = page.getByRole('region', { name: 'Branches' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('redesign')).toBeVisible();

  await panel.getByLabel('Branch name', { exact: true }).fill('november');
  await panel.getByRole('button', { name: 'Create branch', exact: true }).click();
  await expect
    .poll(() => sent.find((r) => r.method === 'POST')?.body)
    .toEqual({
      name: 'november',
      fromNumber: 1,
    });

  await panel.getByRole('button', { name: 'Merge into mainline', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge branch redesign' });
  await expect(dialog.getByText('/pages/home/name').first()).toBeVisible();
  const merge = dialog.getByRole('button', { name: 'Merge', exact: true });
  await expect(merge).toBeDisabled();
  await dialog.getByRole('radio', { name: /Branch: "Branch name"/ }).click();
  await expect(merge).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.map(
      (violation) => violation.id,
    ),
  ).toEqual([]);
  expect(sent.filter((r) => r.path.endsWith('/merge'))).toEqual([]);
  await merge.click();
  await expect
    .poll(() => sent.find((r) => r.path.endsWith('/merge'))?.body)
    .toEqual({ resolutions: { '/pages/home/name': 'theirs' } });
});
