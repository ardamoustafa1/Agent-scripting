import { AxeBuilder } from '@axe-core/playwright';

import { serializeRules } from '@verbis/authz';

import { expect, test } from '../../../tests/playwright/test.js';

const tenant = '01990000-0000-7000-8000-000000000001',
  user = '01990000-0000-7000-8000-000000000002';
const dashboard = {
  generatedAt: '2026-10-03T12:00:00.000Z',
  sampleEvents: 0,
  sessions: 0,
  completed: 0,
  completionRate: 0,
  meanDurationMs: null,
  scripts: [],
  agents: [],
  pages: [],
  paths: [],
  outcomes: [],
  sources: [],
  heatmap: [],
  compliance: { eligible: 0, acknowledged: 0, rate: null },
  variants: [],
  comparisons: [],
  active: [],
  liveCampaigns: [],
};
test.use({ locale: 'tr-TR' });
test('read-only analytics uses BFF, exposes empty state, hides export/scheduling and has no axe violations', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session/status')
      return route.fulfill({
        json: {
          user: { id: user, tenantId: tenant, authMethod: 'sso' },
          session: { id: 'session', protocol: 'oidc', expiresAt: '2099-10-03T12:00:00Z' },
          csrfToken: 'csrf',
        },
      });
    if (path === '/api/v1/me/permissions')
      return route.fulfill({
        json: {
          principal: { type: 'user', id: user, tenantId: tenant },
          roles: ['auditor'],
          rules: serializeRules([{ action: 'read', subject: 'Report' }]),
          separationOfDuties: true,
        },
      });
    if (path === '/api/v1/tenant')
      return route.fulfill({
        json: { id: tenant, name: 'Analytics fixture', settings: {}, version: 1 },
      });
    if (path === '/api/v1/analytics/dashboard') {
      expect(route.request().method()).toBe('GET');
      return route.fulfill({ json: dashboard });
    }
    return route.fulfill({ status: 404, json: { code: 'VERBIS_RESOURCE_NOT_FOUND' } });
  });
  await page.goto('/#analytics');
  await expect(page.locator('.vb-analytics')).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toHaveCount(0);
  await expect(page.getByText('Zamanlanmış e-posta raporu')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('.vb-analytics').analyze()).violations).toEqual(
    [],
  );
});
