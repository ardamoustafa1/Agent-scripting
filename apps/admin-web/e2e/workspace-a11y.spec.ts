/// <reference lib="dom" />
import { AxeBuilder } from '@axe-core/playwright';

import { serializeRules } from '@verbis/authz';

import { expect, test, type Page } from '../../../tests/playwright/test.js';

// A-01..A-03, V-02, U-02/U-03: authenticated admin pages at phone and desktop widths in every theme.
const tenant = '01990000-0000-7000-8000-000000000001',
  user = '01990000-0000-7000-8000-000000000002',
  campaign = '01990000-0000-7000-8000-000000000003';
const dashboard = {
  generatedAt: '2026-10-03T12:00:00.000Z',
  sampleEvents: 80,
  sessions: 1234567,
  completed: 1034567,
  completionRate: 0.8379,
  meanDurationMs: 125000,
  scripts: [
    {
      key: 'onboarding',
      sessions: 20,
      completed: 15,
      completionRate: 0.75,
      meanDurationMs: 125000,
    },
  ],
  agents: [],
  pages: [
    { key: 'welcome', visits: 20, sessions: 20, meanDwellMs: 30000, dropOff: 2, dropOffRate: 0.1 },
  ],
  paths: [{ source: 'welcome', target: 'offer', count: 18 }],
  outcomes: [{ key: 'sale', count: 12 }],
  sources: [{ key: 'customer-lookup', calls: 20, meanLatencyMs: 150, errorRate: 0.05 }],
  heatmap: [],
  compliance: { eligible: 20, acknowledged: 18, rate: 0.9 },
  variants: [],
  comparisons: [],
  active: [],
  liveCampaigns: [{ key: campaign, active: 2, completed: 5 }],
};
const fixtures: Record<string, unknown> = {
  '/api/v1/tenant': { id: tenant, name: 'A11y fixture', settings: {}, version: 1 },
  '/api/v1/analytics/dashboard': dashboard,
  '/api/v1/analytics/schedules': [],
  '/api/v1/campaigns': { data: [{ id: campaign, name: 'Kredi kartı satış' }] },
  '/api/v1/groups': { data: [{ id: user, displayName: 'Ekip Kuzey' }] },
  '/api/v1/users': {
    data: [{ id: user, displayName: 'Ayşe Yılmaz', email: 'ayse@verbis.test', status: 'active' }],
  },
  '/api/v1/authz/roles': [
    { id: tenant, name: 'script_approver', description: null, isSystem: true },
    { id: user, name: 'agent', description: null, isSystem: true },
  ],
  '/api/v1/identity-providers': [
    { id: tenant, displayName: 'Keycloak', protocol: 'oidc', status: 'active' },
  ],
};
async function workspace(page: Page, theme: string) {
  await page.addInitScript((value) => {
    localStorage.setItem('verbis.theme', value);
  }, theme);
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
          roles: ['tenant_admin'],
          rules: serializeRules([{ action: 'manage', subject: 'all' }]),
          separationOfDuties: true,
        },
      });
    const fixture = fixtures[path];
    return fixture === undefined ? route.fulfill({ json: [] }) : route.fulfill({ json: fixture });
  });
}
const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    'best-practice',
  ]);
test.use({ locale: 'tr-TR' });
for (const theme of ['light', 'dark', 'high-contrast'])
  for (const width of [390, 1440])
    for (const route of ['users', 'analytics', 'identity', 'branding'])
      test(`${route} ${theme} ${width}px has no axe violations`, async ({ page }) => {
        await workspace(page, theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/#${route}`);
        await expect(page.locator('h1')).toBeVisible();
        if (route === 'users')
          await expect(page.getByText('Kimlik sağlayıcı').first()).toBeAttached();
        if (route === 'analytics') await expect(page.locator('.vb-analytics-kpis')).toBeVisible();
        if (route === 'identity') await expect(page.getByText('Keycloak').first()).toBeAttached();
        const { violations } = await axe(page).analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      });
// V-02: the brand preview rendered as a white light-theme block inside dark/high-contrast pages.
for (const theme of ['dark', 'high-contrast'])
  test(`brand preview follows the ${theme} theme`, async ({ page }) => {
    await workspace(page, theme);
    await page.goto('/#branding');
    const preview = page.locator('.aw-brand-preview').first();
    await expect(preview).toBeVisible();
    const colors = await preview.evaluate((element) => ({
      preview: getComputedStyle(element.closest('[data-theme]')!).getPropertyValue('--vb-color-bg'),
      page: getComputedStyle(document.documentElement).getPropertyValue('--vb-color-bg'),
      theme: element.closest('[data-theme]')!.getAttribute('data-theme'),
    }));
    expect(colors.theme).toBe(theme);
    expect(colors.preview).toBe(colors.page);
  });
