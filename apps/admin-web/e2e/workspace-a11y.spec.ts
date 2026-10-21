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
const trust = {
  generatedAt: '2026-10-07T12:00:00.000Z',
  windowDays: 30,
  chain: {
    status: 'attention',
    valid: true,
    checked: 1234,
    headSeq: '1234',
    breaks: 0,
    truncated: false,
    signaturesVerified: true,
    checkpointsChecked: 4,
    latestCheckpoint: { seq: '1200', signedAt: '2026-10-05T06:00:00.000Z' },
    checkpointAgeHours: 54,
  },
  launch: { issued: 50, redeemed: 48, denied: 3, anomalies: 1, urlParamsRejected: 2 },
  sensitiveAccess: {
    auditExports: 2,
    secretMetadataViews: 7,
    secretUsageReads: 0,
    userProfileViews: 11,
    privacyExports: 1,
  },
  privacy: { open: 2, processed: 5, oldestOpenAt: '2026-09-20T09:00:00.000Z' },
};
const samlProvider = '01990000-0000-7000-8000-000000000004';
const fixtures: Record<string, unknown> = {
  '/api/v1/trust-center': trust,
  '/api/v1/audit-checkpoints': [
    {
      id: 'cp-1',
      seq: '1200',
      hash: 'a'.repeat(64),
      sessionHeadsDigest: 'b'.repeat(64),
      sessionHeadsCount: 7,
      prevCheckpointId: null,
      keyId: 'audit-key-1',
      signature: 'sig',
      signedAt: '2026-10-05T06:00:00.000Z',
    },
  ],
  '/api/v1/audit-checkpoints/keys': {
    keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'audit-key-1', x: 'abc' }],
  },
  '/api/v1/service-clients': [
    {
      id: tenant,
      version: 2,
      clientId: tenant,
      name: 'Raporlama aktarımı',
      authMethod: 'client_secret_basic',
      scopes: ['read:Report', 'export:Report'],
      status: 'active',
      certificateThumbprint: null,
      lastUsedAt: null,
      tokenEndpoint: 'https://api.example.test/oauth2/acme/token',
    },
  ],
  '/api/v1/me/sessions': {
    data: [
      {
        id: user,
        kind: 'sso',
        protocol: 'oidc',
        idpId: null,
        app: 'admin',
        createdAt: '2026-10-08T08:00:00Z',
        lastSeenAt: '2026-10-08T09:00:00Z',
        expiresAt: '2026-10-08T18:00:00Z',
        ip: '10.0.0.5',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36',
        current: true,
      },
    ],
  },
  '/api/v1/channels': { data: [{ id: tenant, type: 'voice', provider: 'genesys' }] },
  '/api/v1/analytics/event-counts': {
    data: [{ eventType: 'verbis.runtime.session.started.v1', day: '2026-10-07', count: 9 }],
  },
  '/api/health/ready': { status: 'ok', version: '1.0.0', checks: { database: { status: 'up' } } },
  [`/api/v1/identity-providers/${samlProvider}`]: {
    id: samlProvider,
    version: 3,
    displayName: 'Kurumsal SAML',
    protocol: 'saml',
    status: 'active',
    jitProvisioning: false,
    scimEnabled: false,
    endpoints: { metadata: 'https://api.example.test/auth/saml/acme/idp/metadata' },
    config: {
      roleMapping: { rules: [], defaultRoles: [] },
      spCredentials: [
        {
          id: tenant,
          use: 'signing',
          state: 'active',
          certificate: 'MIIBAAAA',
          notAfter: '2099-10-20T00:00:00Z',
        },
        {
          id: user,
          use: 'signing',
          state: 'next',
          certificate: 'MIIBBBBB',
          notAfter: '2099-12-20T00:00:00Z',
        },
      ],
    },
  },
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
    for (const route of [
      'users',
      'analytics',
      'identity',
      'branding',
      'trust',
      'serviceClients',
      'compliance',
      'mySessions',
      'systemHealth',
      'connectors',
    ])
      test(`${route} ${theme} ${width}px has no axe violations`, async ({ page }) => {
        await workspace(page, theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/#${route}`);
        await expect(page.locator('h1')).toBeVisible();
        if (route === 'users')
          await expect(page.getByText('Kimlik sağlayıcı').first()).toBeAttached();
        if (route === 'analytics') await expect(page.locator('.vb-analytics-kpis')).toBeVisible();
        if (route === 'identity') await expect(page.getByText('Keycloak').first()).toBeAttached();
        if (route === 'trust') {
          await expect(page.getByText('Dikkat gerekli').first()).toBeVisible();
          await expect(page.getByText('audit-key-1').first()).toBeAttached();
        }
        if (route === 'serviceClients')
          await expect(page.getByText('Raporlama aktarımı').first()).toBeAttached();
        if (route === 'compliance')
          await expect(page.getByRole('button', { name: 'Kaydı oluştur' })).toBeVisible();
        if (route === 'mySessions') await expect(page.getByText('Bu cihaz')).toBeVisible();
        if (route === 'systemHealth')
          await expect(page.getByText(/Veritabanı/).first()).toBeVisible();
        const { violations } = await axe(page).analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      });
// SAML service-provider certificates (rotate: add, promote, remove) in every theme and width.
for (const theme of ['light', 'dark', 'high-contrast'])
  for (const width of [390, 1440])
    test(`SAML certificates ${theme} ${width}px have no axe violations`, async ({ page }) => {
      await workspace(page, theme);
      await page.route('**/api/v1/identity-providers', (route) =>
        route.fulfill({
          json: [
            { id: samlProvider, displayName: 'Kurumsal SAML', protocol: 'saml', status: 'active' },
          ],
        }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#identity');
      await page.getByRole('button', { name: 'Tüm satırları göster' }).first().click();
      await page
        .getByRole('row')
        .filter({ hasText: 'Kurumsal SAML' })
        .getByRole('button', { name: 'Ayrıntılar', exact: true })
        .click();
      const section = page.getByRole('region', { name: 'SAML hizmet sağlayıcı sertifikaları' });
      await expect(section).toBeVisible();
      await expect(section.getByRole('button', { name: 'Etkinleştir' })).toBeVisible();
      await section.getByRole('button', { name: 'Etkinleştir' }).click();
      await expect(section.getByRole('button', { name: 'Onayla' })).toBeVisible();
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

test('reopens the console page the sign-in started from, once', async ({ page }) => {
  await workspace(page, 'light');
  // The sign-in link stored the open page before the IdP round trip (auth-api rememberReturnRoute).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('verbis.test.seeded') === null) {
      sessionStorage.setItem('verbis.test.seeded', '1');
      sessionStorage.setItem('verbis.admin.returnRoute', '#trust');
    }
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/#trust$/);
  await expect(page.getByText('Dikkat gerekli').first()).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('verbis.admin.returnRoute'))).toBeNull();
  // Opening the start page again stays there: the route is used only once.
  await page.goto('/');
  await expect(page).not.toHaveURL(/#trust/);
});
