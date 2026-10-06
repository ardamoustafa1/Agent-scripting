import { AxeBuilder } from '@axe-core/playwright';

import { serializeRules } from '@verbis/authz';

import { expect, test } from '../../../tests/playwright/test.js';

test.use({ locale: 'tr-TR' });
const tenantId = '01990000-0000-7000-8000-000000000001';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = { data: [], page: { nextCursor: null } };
    if (url.pathname === '/api/auth/session/status')
      body = {
        user: { id: tenantId, tenantId, authMethod: 'sso' },
        session: { id: tenantId, protocol: 'oidc', expiresAt: '2030-01-01T00:00:00Z' },
        csrfToken: 'fixture-csrf',
      };
    else if (url.pathname === '/api/v1/me/permissions')
      body = {
        principal: { type: 'user', id: tenantId, tenantId },
        roles: ['super_admin'],
        rules: serializeRules([{ action: 'manage', subject: 'all' }]),
        separationOfDuties: true,
      };
    else if (url.pathname === '/api/v1/tenant')
      body = { id: tenantId, name: 'Fixture tenant', settings: {}, version: 1 };
    else if (url.pathname === '/api/health/ready')
      body = {
        status: 'ok',
        service: 'verbis-api',
        checks: { database: { status: 'up' }, redis: { status: 'up' }, nats: { status: 'up' } },
      };
    else if (url.pathname === '/api/v1/connector-dead-letters')
      body = { durable: true, persisted: 0, persistFailures: 0 };
    else if (url.pathname === '/api/v1/admin/outbox')
      body = { pending: 0, published: 7, dead: 0, oldestPendingAt: null, deadEvents: [] };
    else if (url.pathname === '/api/v1/admin/operations')
      body = { windowHours: 24, total: 4, failed: 1, errorRate: 0.25 };
    await route.fulfill({ json: body });
  });
});
for (const theme of ['light', 'dark', 'high-contrast'] as const)
  test(`workspace keyboard and axe (${theme})`, async ({ page }) => {
    await page.goto('/#systemHealth');
    await page.getByLabel('Tema').selectOption(theme);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Sistem sağlığı' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'İçeriğe geç' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  });
test('version conflict does not overwrite policy or claim success', async ({ page }) => {
  await page.route('**/api/v1/tenant/settings', (route) =>
    route.fulfill({
      status: 412,
      json: { code: 'VERBIS_VERSION_MISMATCH', correlationId: 'fixture-correlation' },
    }),
  );
  await page.goto('/#security');
  await page
    .locator('.aw-card')
    .filter({ has: page.getByRole('heading', { name: 'Güvenlik politikaları', exact: true }) })
    .getByRole('button', { name: 'Kaydet', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Kayıt başka biri tarafından değiştirildi');
  await expect(page.getByRole('alert')).toContainText('Destek kodu: fixture-correlation');
  await expect(page.getByRole('alert')).not.toContainText('VERBIS_');
  await expect(page.getByText('İşlem tamamlandı', { exact: true })).toHaveCount(0);
});
test('secret values are cleared after rotation and never rendered in metadata', async ({
  page,
}) => {
  await page.route('**/api/v1/secrets', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      await route.fulfill({
        status: 201,
        json: { id: tenantId, name: 'fixture-secret', kind: 'api_key', version: 1 },
      });
    } else await route.fulfill({ json: { data: [], page: { nextCursor: null } } });
  });
  await page.goto('/#secrets');
  await page.getByLabel('Ad', { exact: true }).fill('fixture-secret');
  const input = page.getByLabel('Secret değeri: yeni / değiştir');
  await input.fill('ephemeral-fixture-value');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByText('ephemeral-fixture-value', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify(
        Object.fromEntries(
          Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
        ),
      ),
    ),
  ).not.toContain('ephemeral-fixture-value');
});

for (const theme of ['light', 'dark']) {
  test(`@visual admin-web main screen ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.setFixedTime(new Date('2026-10-03T09:00:00Z'));
    await page.addInitScript((value) => {
      localStorage.setItem('verbis.theme', value);
    }, theme);
    await page.goto('/#systemHealth');
    await expect(page.getByRole('heading', { level: 1, name: 'Sistem sağlığı' })).toBeVisible();
    await expect(page.locator('.aw-json').first()).toHaveValue(/"status": "ok"/);
    await expect(page.locator('.aw-stats strong').filter({ hasText: /^7$/ })).toBeVisible();
    await expect(page.getByText(/25\.0%/)).toBeVisible();
    await page.evaluate('document.fonts.ready.then(() => undefined)');
    await expect(page).toHaveScreenshot(`admin-web-${theme}.png`, { fullPage: true });
  });
}

for (const [valid, truncated, message] of [
  [true, false, 'İncelenen aralık doğrulandı'],
  [false, false, 'Zincir doğrulaması başarısız'],
  [true, true, 'Report'],
] as const) {
  test(`audit verification distinguishes valid=${valid}, truncated=${truncated}`, async ({
    page,
  }) => {
    await page.route('**/api/v1/audit-events/verify', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      expect(route.request().postDataJSON()).toEqual({ fromSeq: '1', toSeq: '10' });
      await route.fulfill({ json: { valid, truncated, fromSeq: '1', toSeq: '10', checked: 10 } });
    });
    await page.goto('/#audit');
    await page.getByLabel('Başlangıç sıra no', { exact: true }).fill('1');
    await page.getByLabel('Bitiş sıra no', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Bütünlüğü doğrula', exact: true }).click();
    if (truncated) {
      await expect(page.locator('.aw-card > [role="status"]')).not.toContainText(
        'İncelenen aralık doğrulandı',
      );
      await expect(page.locator('.aw-card > [role="status"]')).toContainText('sınırlı');
    } else await expect(page.locator('.aw-card > [role="status"]')).toContainText(message);
  });
}

test('audit explorer displays event sequence, action and correlation without raw customer data', async ({
  page,
}) => {
  await page.route('**/api/v1/audit-events?*', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: tenantId,
            seq: '10',
            action: 'script.version.published',
            outcome: 'success',
            occurredAt: '2026-10-03T09:00:00Z',
            correlationId: 'synthetic-audit-correlation',
          },
        ],
        page: { nextCursor: null },
      },
    }),
  );
  await page.goto('/#audit');
  await expect(page.getByText('script.version.published', { exact: true })).toBeVisible();
  await expect(page.getByText('synthetic-audit-correlation', { exact: true })).toBeVisible();
});

test('changing sign-in email discards completed and late SSO discovery', async ({ page }) => {
  await page.route('**/api/auth/session/status', (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  let release!: () => void;
  let started!: () => void;
  const arrived = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/auth/discover', async (route) => {
    calls++;
    if (calls === 2) {
      started();
      await pending;
    }
    await route.fulfill({
      json: {
        tenant: 'first',
        providers: [{ id: 'first-idp', displayName: 'First SSO', protocol: 'oidc' }],
      },
    });
  });
  await page.goto('/');
  const email = page.getByLabel('İş e-postası');
  await email.fill('user@first.test');
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  const provider = page.getByRole('link', { name: 'First SSO ile oturum aç' });
  await expect(provider).toBeVisible();
  await email.fill('user@second.test');
  await expect(provider).toHaveCount(0);
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  await arrived;
  await email.fill('user@third.test');
  const response = page.waitForResponse('**/api/auth/discover');
  release();
  await response;
  await expect(provider).toHaveCount(0);
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  await expect(provider).toBeVisible();
  expect(calls).toBe(3);
});

test('a session service outage shows retry and recovers without a false sign-in form', async ({
  page,
}) => {
  let failed = true;
  await page.route('**/api/auth/session/status', (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { code: 'VERBIS_HTTP_UNAVAILABLE' } }
        : { json: { authenticated: false } },
    ),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Sunucuya ulaşılamıyor');
  await expect(page.getByRole('alert')).not.toContainText('VERBIS_');
  await expect(page.getByLabel('İş e-postası')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Yeniden dene', exact: true }).click();
  await expect(page.getByLabel('İş e-postası')).toBeVisible();
});

test('branding preview opens unsaved values, closes by keyboard and keeps the form', async ({
  page,
}) => {
  await page.goto('/#branding');
  await page.getByLabel('Ad', { exact: true }).fill('Unsaved synthetic brand');
  await page.getByLabel('Agent başlığı', { exact: true }).fill('Unsaved agent title');
  await page.getByLabel('Bekleme ekranı metni', { exact: true }).fill('Unsaved waiting text');
  await page.getByRole('button', { name: 'Önizleme', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Önizleme', exact: true });
  await expect(dialog.getByText('Unsaved synthetic brand')).toBeVisible();
  await expect(dialog.getByText('Unsaved agent title')).toBeVisible();
  await expect(dialog.getByText('Unsaved waiting text')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Ad', { exact: true })).toHaveValue('Unsaved synthetic brand');
  await expect(page.getByRole('button', { name: 'Önizleme', exact: true })).toBeFocused();
});

test('deleting a different SIEM destination requires its own confirmation', async ({ page }) => {
  const secondId = '01990000-0000-7000-8000-000000000002';
  await page.route('**/api/v1/siem-destinations', (route) =>
    route.fulfill({
      json: [
        { id: tenantId, name: 'First destination', kind: 'webhook', version: 1 },
        { id: secondId, name: 'Second destination', kind: 'webhook', version: 1 },
      ],
    }),
  );
  const deleted: string[] = [];
  await page.route('**/api/v1/siem-destinations/*', (route) => {
    if (route.request().method() === 'DELETE') deleted.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await page.goto('/#audit');
  const table = page.getByRole('table', { name: 'SIEM hedefleri', exact: true });
  await table
    .getByRole('row')
    .filter({ hasText: 'First destination' })
    .getByRole('button', { name: 'Ayrıntılar' })
    .click();
  await page.getByRole('button', { name: 'Kaldır', exact: true }).click();
  await expect(page.getByRole('button', { name: 'İşlemi onayla', exact: true })).toBeVisible();
  await table
    .getByRole('row')
    .filter({ hasText: 'Second destination' })
    .getByRole('button', { name: 'Ayrıntılar' })
    .click();
  await expect(page.getByRole('button', { name: 'İşlemi onayla', exact: true })).toHaveCount(0);
  expect(deleted).toEqual([]);
  await page.getByRole('button', { name: 'Kaldır', exact: true }).click();
  await page.getByRole('button', { name: 'İşlemi onayla', exact: true }).click();
  await expect.poll(() => deleted.length).toBe(1);
  expect(deleted[0]).toContain(secondId);
});

test('super-admin tenant management shares the product frame and accessible surfaces', async ({
  page,
}) => {
  await page.goto('/#tenants');
  await expect(page.getByRole('heading', { level: 1, name: 'Tenant yönetimi' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('admin-tenants.png'), fullPage: true });
});
