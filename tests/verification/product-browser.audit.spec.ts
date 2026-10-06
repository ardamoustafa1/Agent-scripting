import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  chromium,
  firefox,
  webkit,
  expect as browserExpect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import { RedisService } from '../../apps/api/src/infra/redis/redis.service.js';
import { SESSION_STORE } from '../../apps/api/src/modules/identity/core/identity.tokens.js';
import { type SessionStore } from '../../apps/api/src/modules/identity/session/session-store.js';
import { CollaborationService } from '../../apps/api/src/modules/scripts/collaboration.service.js';
import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
} from '../../apps/api/test/integration/helpers.js';
import { createTokenKit } from '../../apps/api/test/support/tokens.js';
import { AxeBuilder } from '../../apps/designer-web/node_modules/@axe-core/playwright/dist/index.js';
import { surveyScript } from '../../packages/script-schema/dist/fixtures/index.js';

import type { NestFastifyApplication } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const evidence = process.env['PRODUCT_BROWSER_EVIDENCE'] ?? '/tmp/verbis-product-browser-audit';
const children: ChildProcess[] = [];
let owner: PrismaClient, app: NestFastifyApplication, browser: Browser;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let scriptId: string, versionNumber: number, campaignId: string;
const origins: Partial<Record<'admin' | 'designer' | 'agent', string>> = {};
const contexts: BrowserContext[] = [];
const failures: string[] = [];
async function port() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Missing local port');
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  return address.port;
}
async function context(kind: 'admin' | 'designer' | 'agent', userId = tenant.adminId) {
  const origin = origins[kind]!;
  const session = await app.get<SessionStore>(SESSION_STORE).create(
    {
      tenantId: tenant.tenantId,
      userId,
      kind: 'sso',
      protocol: 'oidc',
      app: kind,
      ip: '127.0.0.1',
      userAgent: 'local product verification',
    },
    { idleTimeoutSeconds: 600, absoluteTimeoutSeconds: 3600, maxConcurrent: 20, onLimit: 'deny' },
  );
  const ctx = await browser.newContext({ baseURL: origin, locale: 'en-US' });
  contexts.push(ctx);
  await ctx.addCookies([
    {
      name: '__Host-verbis_session',
      value: session.token,
      domain: 'localhost',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await ctx.addInitScript(
    ({ tenantId, user }) => {
      localStorage.setItem(`verbis.tour.${tenantId}.${user}`, 'done');
    },
    { tenantId: tenant.tenantId, user: userId },
  );
  return ctx;
}
async function roleUser(roleName: string, label: string) {
  const user = await owner.user.create({
    data: {
      tenantId: tenant.tenantId,
      email: `${label}@roles.test`,
      displayName: label,
      locale: 'en',
      status: 'active',
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  const role = await owner.role.findFirstOrThrow({
    where: { tenantId: tenant.tenantId, name: roleName },
  });
  await owner.userRole.create({
    data: {
      tenantId: tenant.tenantId,
      userId: user.id,
      roleId: role.id,
      scope: { campaignIds: '*', teamIds: '*', siteIds: '*' },
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  return user.id;
}
function observe(page: Page) {
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500)
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
}
beforeAll(async () => {
  mkdirSync(evidence, { recursive: true });
  owner = ownerPrisma();
  const kit = await createTokenKit();
  const ports = { admin: await port(), designer: await port(), agent: await port() };
  const collaborationPort = await port();
  for (const kind of ['admin', 'designer', 'agent'] as const)
    origins[kind] = `http://localhost:${ports[kind]}`;
  app = await startApp(
    integrationEnv(kit.jwks, {
      INTEGRATION_MASTER_KEY: randomBytes(32).toString('base64'),
      AUTH_APP_ORIGINS: Object.entries(origins)
        .map(([key, value]) => `${key}=${value}`)
        .join(','),
      COLLABORATION_PORT: String(collaborationPort),
      COLLABORATION_ADDRESS: '127.0.0.1',
    }),
  );
  await app.listen(0, '127.0.0.1');
  process.stdout.write('Product audit: local API ready\n');
  tenant = await createTenant(owner, kit, uniqueSlug('product-browser'));
  const auth = await tenant.auth();
  const campaign = await app.inject({
    method: 'POST',
    url: '/v1/campaigns',
    headers: auth,
    payload: {
      name: 'Synthetic acceptance campaign',
      status: 'active',
      channels: ['voice'],
      defaultLocale: 'en',
    },
  });
  expect(campaign.statusCode, campaign.body).toBe(201);
  campaignId = campaign.json<{ id: string }>().id;
  const script = await app.inject({
    method: 'POST',
    url: '/v1/scripts',
    headers: auth,
    payload: { name: 'Synthetic browser audit' },
  });
  expect(script.statusCode, script.body).toBe(201);
  scriptId = script.json<{ id: string }>().id;
  const version = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${scriptId}/versions`,
    headers: auth,
    payload: { document: surveyScript, screens: [] },
  });
  expect(version.statusCode, version.body).toBe(201);
  versionNumber = version.json<{ number: number }>().number;
  for (const kind of ['admin', 'designer', 'agent'] as const) {
    const child = spawn('pnpm', ['exec', 'vite', '--port', String(ports[kind])], {
      cwd: `${root}/apps/${kind}-web`,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        API_INTERNAL_URL: await app.getUrl(),
        [`${kind.toUpperCase()}_WEB_PORT`]: String(ports[kind]),
        COLLABORATION_INTERNAL_URL: `http://127.0.0.1:${collaborationPort}`,
        DESIGNER_ENVIRONMENT: 'test',
      },
    });
    children.push(child);
    // Never record child environment, session cookies or request headers in evidence.
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    await browserExpect
      .poll(
        async () => {
          if (child.exitCode !== null)
            throw new Error(`Vite ${kind} exited: ${output.slice(-1500)}`);
          try {
            return (await fetch(`${origins[kind]}/health`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 30000 },
      )
      .toBe(true);
  }
  const engine = process.env['PRODUCT_BROWSER_ENGINE'] ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(engine))
    throw new Error('Unsupported audit browser');
  process.stdout.write('Product audit: Vite apps ready\n');
  browser = await { chromium, firefox, webkit }[
    engine as 'chromium' | 'firefox' | 'webkit'
  ].launch();
});
// Each case starts with fresh test-only sessions and limiter counters. Production rate
// limits remain enabled; separate rate-limit tests verify rejection and Retry-After.
beforeEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
  await app.get<SessionStore>(SESSION_STORE).revokeAllForUser(tenant.tenantId, tenant.adminId);
  const redis = app.get(RedisService).client;
  const keys = await redis.keys('verbis:api:rl:*');
  if (keys.length) await redis.del(...keys.map((key) => key.slice('verbis:api:'.length)));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.allSettled(contexts.map((ctx) => ctx.close()));
  await browser.close();
  process.stdout.write('Product audit: browser closed\n');
  for (const child of children) child.kill('SIGTERM');
  process.stdout.write('Product audit: closing API\n');
  await app.close();
  process.stdout.write('Product audit: API closed\n');
  await owner.$disconnect();
});
const mode = async (page: Page, name: string) => {
  await page.getByRole('combobox', { name: 'Editor', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
};
describe('Real frontend / API / PostgreSQL / Redis product audit (no response mocks)', () => {
  it('loads all three applications with actual BFF sessions and checks responsive horizontal overflow', async () => {
    for (const kind of ['admin', 'designer', 'agent'] as const) {
      const ctx = await context(kind);
      const page = await ctx.newPage();
      observe(page);
      await page.goto(kind === 'designer' ? '/scripts' : '/');
      await browserExpect(page.getByRole('main')).toBeVisible();
      if (kind === 'designer') {
        await browserExpect(
          page.getByText('Synthetic browser audit', { exact: true }),
        ).toBeVisible();
        await browserExpect(page.getByRole('link', { name: 'Scripts', exact: true })).toHaveClass(
          /\bdw-nav\b/,
        );
      }
      const session = await page.request.get('/api/auth/session');
      expect(session.status()).toBe(200);
      expect(((await session.json()) as { user: { id: string } }).user.id).toBe(tenant.adminId);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: `${evidence}/${kind}-${width}.png`, fullPage: true });
        const size = await page.evaluate<{ width: number; scroll: number }>(
          '({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })',
        );
        expect
          .soft(size.scroll, `${kind} ${width}px document overflow`)
          .toBeLessThanOrEqual(size.width + 1);
      }
    }
    expect(failures).toEqual([]);
  });
  for (const [kind, routes] of [
    [
      'admin',
      [
        'analytics',
        'identity',
        'users',
        'connectors',
        'secrets',
        'ai',
        'audit',
        'security',
        'data',
        'branding',
        'simulator',
        'systemHealth',
      ],
    ],
    [
      'designer',
      [
        'analytics',
        'campaigns',
        'scripts',
        'screens',
        'integrations',
        'variables',
        'ai',
        'templates',
        'releases',
        'settings',
      ],
    ],
  ] as const) {
    for (const route of routes)
      it(`${kind} ${route}: real API, responsive layout and no browser exception`, async () => {
        const page = await (await context(kind)).newPage();
        observe(page);
        await page.goto(kind === 'admin' ? `/#${route}` : `/${route}`);
        const sessionResponse = await page.request.get('/api/auth/session');
        expect(sessionResponse.status(), `${kind}/${route} session`).toBe(200);
        const permissionsResponse = await page.request.get('/api/v1/me/permissions');
        expect(permissionsResponse.status(), `${kind}/${route} permissions`).toBe(200);
        await browserExpect(page.getByRole('main'))
          .toBeVisible()
          .catch(async (error: unknown) => {
            await page.screenshot({
              path: `${evidence}/${kind}-${route}-failure.png`,
              fullPage: true,
            });
            throw new Error(`${String(error)}; body: ${await page.locator('body').innerText()}`);
          });
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        for (const width of [320, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({
            path: `${evidence}/${kind}-${route}-${width}.png`,
            fullPage: true,
          });
          const size = await page.evaluate<{ width: number; scroll: number }>(
            '({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })',
          );
          expect
            .soft(size.scroll, `${kind}/${route} ${width}px overflow`)
            .toBeLessThanOrEqual(size.width + 1);
        }
        expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
        expect(failures).toEqual([]);
        await page.close();
      });
  }
  for (const detail of [
    'script',
    'edit',
    'release',
    'assignments',
    'packages',
    'new-integration',
  ] as const)
    it(`designer detailed ${detail}: responsive controls remain reachable`, async () => {
      const page = await (await context('designer')).newPage();
      observe(page);
      const path =
        detail === 'new-integration'
          ? '/integrations/new'
          : detail === 'script'
            ? `/scripts/${scriptId}`
            : detail === 'edit' || detail === 'release'
              ? `/scripts/${scriptId}/versions/${versionNumber}/${detail}`
              : `/scripts/${scriptId}/${detail}`;
      await page.goto(path);
      await browserExpect(page.getByRole('main')).toBeVisible();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      if (detail === 'edit') {
        await page.getByRole('tab', { name: 'Layers', exact: true }).click();
        await page.getByRole('treeitem').first().locator('button').last().click();
      }
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({
          path: `${evidence}/designer-detail-${detail}-${width}.png`,
          fullPage: true,
        });
        const size = await page.evaluate<{ width: number; scroll: number }>(
          '({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })',
        );
        expect
          .soft(size.scroll, `${detail} ${width}px document overflow`)
          .toBeLessThanOrEqual(size.width + 1);
        if (detail === 'edit') {
          await browserExpect(page.locator('.ed-inspector')).toBeVisible();
          const bounds = await page.locator('.ed-inspector').boundingBox();
          expect
            .soft(bounds!.x + bounds!.width, `${width}px inspector is outside the usable screen`)
            .toBeLessThanOrEqual(width + 1);
        }
      }
      expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
      expect(failures).toEqual([]);
    });
  it('creates a script and its first draft through browser forms and verifies persisted database records', async () => {
    const page = await (await context('designer')).newPage();
    observe(page);
    await page.goto('/scripts');
    await page.getByRole('button', { name: 'New script', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Browser-created persisted script');
    await dialog.getByLabel('Campaign', { exact: true }).selectOption(campaignId);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await browserExpect(page).toHaveURL(/\/scripts\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    const saved = await owner.script.findUniqueOrThrow({ where: { id } });
    expect(saved.tenantId).toBe(tenant.tenantId);
    expect(saved.name).toBe('Browser-created persisted script');
    await page.getByRole('button', { name: 'Create first draft', exact: true }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/scripts/${id}/versions/1/edit$`));
    expect(await owner.scriptVersion.count({ where: { scriptId: id } })).toBe(1);
    expect(failures).toEqual([]);
  });
  it('creates and activates a campaign with outcome requirements through the real browser and database', async () => {
    const userId = await roleUser('campaign_manager', 'campaign-flow');
    const page = await (await context('designer', userId)).newPage();
    observe(page);
    await page.goto('/campaigns');
    await page
      .getByRole('main')
      .getByRole('button', { name: 'New campaign', exact: true })
      .first()
      .click();
    await page
      .getByRole('dialog')
      .getByLabel('Name', { exact: true })
      .fill('Browser persisted campaign');
    await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
    await browserExpect(page).toHaveURL(/\/campaigns\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.getByRole('tab', { name: 'Campaign settings' }).click();
    await page.getByRole('combobox', { name: 'Status', exact: true }).click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();
    await page.getByRole('button', { name: 'Add outcome' }).click();
    await page.getByLabel('Outcome code', { exact: true }).fill('SUCCESS');
    await page.getByLabel('Outcome label', { exact: true }).fill('Resolved');
    await page.getByRole('checkbox', { name: 'Require a note' }).check();
    await page.getByLabel('Required script fields (comma-separated)').fill('qaResult, reference');
    await page.getByLabel('Sub-dispositions (comma-separated)').fill('DONE, FOLLOW_UP');
    const saved = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/campaigns/${id}` && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save campaign' }).click();
    expect((await saved).status()).toBe(200);
    await browserExpect(page.getByRole('status')).toHaveText('Campaign saved');
    expect(await owner.campaign.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'active',
      outcomeSet: [
        {
          code: 'SUCCESS',
          requiresNote: true,
          requiredFields: ['qaResult', 'reference'],
          subCodes: ['DONE', 'FOLLOW_UP'],
        },
      ],
    });
    await page.reload();
    await browserExpect(page.getByLabel('Outcome code', { exact: true })).toHaveValue('SUCCESS');
    await browserExpect(page.getByRole('checkbox', { name: 'Require a note' })).toBeChecked();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${evidence}/campaign-settings-${width}.png`, fullPage: true });
      const size = await page.evaluate<{ width: number; scroll: number }>(
        '({width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth})',
      );
      expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    }
    for (const [label, status] of [
      ['Paused', 'paused'],
      ['Archived', 'archived'],
      ['Draft', 'draft'],
      ['Active', 'active'],
    ] as const) {
      await page.getByRole('combobox', { name: 'Status', exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
      const changed = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/v1/campaigns/${id}` &&
          r.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: 'Save campaign' }).click();
      expect((await changed).status()).toBe(200);
      await browserExpect(page.getByRole('status')).toHaveText('Campaign saved');
      await page.reload();
      await browserExpect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveText(
        label,
      );
      expect((await owner.campaign.findUniqueOrThrow({ where: { id } })).status).toBe(status);
    }
    const beforeConflict = await owner.campaign.findUniqueOrThrow({ where: { id } });
    const external = await app.inject({
      method: 'PATCH',
      url: `/v1/campaigns/${id}`,
      headers: { ...(await tenant.auth()), 'if-match': `"${beforeConflict.version}"` },
      payload: { description: 'Another authorized editor changed this version' },
    });
    expect(external.statusCode).toBe(200);
    await page.getByLabel('Name', { exact: true }).fill('Unsaved conflicted campaign');
    const rejected = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/campaigns/${id}` && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save campaign' }).click();
    expect((await rejected).status()).toBe(412);
    await browserExpect(page.getByRole('alert')).toBeVisible();
    await browserExpect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'Unsaved conflicted campaign',
    );
    expect((await owner.campaign.findUniqueOrThrow({ where: { id } })).name).toBe(
      'Browser persisted campaign',
    );
    expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
    expect(failures).toEqual([]);
  });
  it('creates and rotates a secret without displaying its value after save or reload', async () => {
    const page = await (await context('admin')).newPage();
    observe(page);
    await page.goto('/#secrets');
    await page.getByLabel('Name', { exact: true }).fill('Synthetic browser secret');
    const input = page.getByLabel('Secret value: new / replace', { exact: true });
    await input.fill('synthetic-browser-value');
    const created = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/secrets' && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const metadata = (await response.json()) as {
      id: string;
      value?: unknown;
      ciphertext?: unknown;
    };
    expect(metadata.value).toBeUndefined();
    expect(metadata.ciphertext).toBeUndefined();
    await browserExpect(input).toHaveValue('');
    const initial = await owner.secret.findUniqueOrThrow({ where: { id: metadata.id } });
    expect(Buffer.from(initial.ciphertext).toString()).not.toContain('synthetic-browser-value');
    await page
      .getByRole('row')
      .filter({ hasText: 'Synthetic browser secret' })
      .getByRole('button', { name: 'Details', exact: true })
      .click();
    await browserExpect(
      page.getByRole('heading', { name: 'Rotate secret', exact: true }),
    ).toBeVisible();
    await input.fill('synthetic-browser-rotated');
    const rotated = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/secrets/${metadata.id}` &&
        r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await rotated).status()).toBe(200);
    await browserExpect(input).toHaveValue('');
    const final = await owner.secret.findUniqueOrThrow({ where: { id: metadata.id } });
    expect(final.version).toBe(initial.version + 1);
    expect(Buffer.from(final.ciphertext).equals(Buffer.from(initial.ciphertext))).toBe(false);
    await page.reload();
    await page
      .getByRole('row')
      .filter({ hasText: 'Synthetic browser secret' })
      .getByRole('button', { name: 'Details', exact: true })
      .click();
    await browserExpect(input).toHaveValue('');
    expect(await page.locator('body').innerText()).not.toContain('synthetic-browser-rotated');
    expect(failures).toEqual([]);
  });
  for (const [role, adminRoutes, designerRoutes, canCreateScript] of [
    [
      'tenant_admin',
      [
        'analytics',
        'identity',
        'users',
        'connectors',
        'secrets',
        'ai',
        'audit',
        'security',
        'data',
        'branding',
        'simulator',
        'systemHealth',
      ],
      [
        'analytics',
        'campaigns',
        'scripts',
        'screens',
        'integrations',
        'variables',
        'ai',
        'templates',
        'releases',
        'settings',
      ],
      true,
    ],
    ['security_auditor', ['audit'], [], false],
    [
      'script_designer',
      [],
      [
        'campaigns',
        'scripts',
        'screens',
        'integrations',
        'variables',
        'ai',
        'templates',
        'releases',
      ],
      true,
    ],
    [
      'script_approver',
      [],
      ['campaigns', 'scripts', 'screens', 'variables', 'templates', 'releases'],
      false,
    ],
    [
      'integration_engineer',
      ['connectors', 'secrets', 'simulator', 'systemHealth'],
      ['campaigns', 'integrations'],
      false,
    ],
    [
      'campaign_manager',
      ['analytics', 'users'],
      ['analytics', 'campaigns', 'scripts', 'variables', 'templates', 'releases'],
      false,
    ],
    [
      'supervisor',
      ['analytics', 'users'],
      ['analytics', 'campaigns', 'scripts', 'variables', 'templates', 'releases'],
      false,
    ],
    ['agent', ['users'], ['scripts', 'screens', 'variables', 'templates', 'releases'], false],
    ['report_viewer', ['analytics'], ['analytics'], false],
    [
      'api_client',
      ['analytics'],
      ['analytics', 'campaigns', 'scripts', 'screens', 'variables', 'templates', 'releases'],
      false,
    ],
  ] as const)
    it(`${role}: authenticated navigation and denied script writes match role permissions`, async () => {
      const userId = await roleUser(role, role);
      for (const kind of ['admin', 'designer'] as const) {
        const page = await (await context(kind, userId)).newPage();
        observe(page);
        await page.goto(kind === 'admin' ? '/' : '/campaigns');
        expect((await page.request.get('/api/v1/me/permissions')).status()).toBe(200);
        await browserExpect(page.getByRole('main')).toBeVisible();
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        const links = await page
          .locator(kind === 'admin' ? '.aw-rail nav a' : '.dw-rail nav a')
          .all();
        const routes = await Promise.all(
          links.map(async (link) => {
            const href = await link.getAttribute('href');
            if (!href) throw new Error('Navigation link has no destination');
            return href.slice(1);
          }),
        );
        expect(routes).toEqual(kind === 'admin' ? adminRoutes : designerRoutes);
        if (kind === 'designer' && !canCreateScript) {
          await browserExpect(
            page.getByRole('button', { name: 'New script', exact: true }),
          ).toHaveCount(0);
          const session = await page.request.get('/api/auth/session');
          const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
          const rejected = await page.request.post('/api/v1/scripts', {
            headers: { 'x-csrf-token': csrf },
            data: { name: 'Forbidden role write' },
          });
          expect(rejected.status()).toBe(403);
          expect(
            await owner.script.count({
              where: { tenantId: tenant.tenantId, name: 'Forbidden role write' },
            }),
          ).toBe(0);
        }
        await page.screenshot({ path: `${evidence}/role-${role}-${kind}.png`, fullPage: true });
      }
      expect(failures).toEqual([]);
    });
  it('saves branding through the real API and retains it after reload', async () => {
    const page = await (await context('admin')).newPage();
    observe(page);
    await page.goto('/#branding');
    await page.getByLabel('Name', { exact: true }).fill('Synthetic saved brand');
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/tenant/settings' &&
        response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).status()).toBe(200);
    const record = await owner.tenant.findUniqueOrThrow({ where: { id: tenant.tenantId } });
    expect(record.settings).toMatchObject({ brand: { name: 'Synthetic saved brand' } });
    await page.reload();
    await browserExpect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'Synthetic saved brand',
    );
    expect(failures).toEqual([]);
  });
  it('synchronizes two distinct real users and persists peer edits after closing the collaboration room', async () => {
    process.stdout.write('Product audit: collaboration case starting\n');
    const peerUser = await owner.user.create({
      data: {
        tenantId: tenant.tenantId,
        email: 'peer@browser.test',
        displayName: 'Synthetic peer',
        status: 'active',
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
    const role = await owner.role.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, name: 'tenant_admin' },
    });
    await owner.userRole.create({
      data: {
        tenantId: tenant.tenantId,
        userId: peerUser.id,
        roleId: role.id,
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
    const first = await (await context('designer')).newPage();
    const second = await (await context('designer', peerUser.id)).newPage();
    for (const page of [first, second]) observe(page);
    await Promise.all(
      [first, second].map((page) =>
        page.goto(`/scripts/${scriptId}/versions/${versionNumber}/edit`),
      ),
    );
    for (const page of [first, second]) {
      await page.getByRole('button', { name: 'Join collaborative editing', exact: true }).click();
      await browserExpect(page.getByText('Saved · connected', { exact: true })).toBeVisible();
      await mode(page, 'Rules');
    }
    await first.getByRole('button', { name: 'Add rule', exact: true }).click();
    await first.getByLabel('Description', { exact: true }).fill('Synthetic shared rule');
    await second.getByRole('combobox', { name: 'Rule builder', exact: true }).click();
    await second.getByRole('option', { name: 'Synthetic shared rule', exact: true }).click();
    await browserExpect(
      second.getByRole('combobox', { name: 'Rule builder', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    await second.getByLabel('Description', { exact: true }).focus();
    await browserExpect(second.getByLabel('Description', { exact: true })).toBeFocused();
    await browserExpect(second.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic shared rule',
    );
    await second.getByLabel('Description', { exact: true }).fill('Synthetic peer update');
    await browserExpect(second.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic peer update',
    );
    await browserExpect(first.getByLabel('Description', { exact: true }))
      .toHaveValue('Synthetic peer update')
      .catch(async (error: unknown) => {
        for (const [label, page] of [
          ['first', first],
          ['peer', second],
        ] as const) {
          await page.screenshot({
            path: `${evidence}/collaboration-${label}-failure.png`,
            fullPage: true,
          });
          process.stdout.write(
            `Collaboration ${label}: ${await page.locator('.lc-presence').innerText()} / ${await page.getByLabel('Description', { exact: true }).inputValue()}\n`,
          );
        }
        throw error;
      });
    // Exercise both directions across panel switches, not just the first edit.
    // Each assertion uses the unchanged 5s convergence budget.
    for (let round = 0; round < 5; round++) {
      await mode(first, 'Screen');
      await mode(first, 'Rules');
      const value = `Synthetic converged round ${round}`;
      await first.getByLabel('Description', { exact: true }).fill(value);
      await browserExpect(second.getByLabel('Description', { exact: true })).toHaveValue(value);
      await second.getByLabel('Description', { exact: true }).fill('Synthetic peer update');
      await browserExpect(second.getByLabel('Description', { exact: true })).toHaveValue(
        'Synthetic peer update',
      );
      await browserExpect(first.getByLabel('Description', { exact: true })).toHaveValue(
        'Synthetic peer update',
      );
    }
    // Drop the actual server WebSockets; the provider must obtain a new ticket
    // and reconnect without a reload or a test-created replacement provider.
    await browserExpect(second.getByText('Saving changes', { exact: true })).toBeVisible();
    const reconnecting = second.waitForEvent('websocket');
    const collaboration = app.get<CollaborationService>(CollaborationService) as unknown as {
      server: {
        hocuspocus: {
          documents: Map<
            string,
            {
              connections: Map<{ webSocket: { terminate(): void } }, unknown>;
            }
          >;
        };
      };
    };
    const room = collaboration.server.hocuspocus.documents.get(
      `${tenant.tenantId}:${scriptId}:${versionNumber}`,
    );
    expect(room?.connections.size).toBe(2);
    for (const connection of room!.connections.keys()) connection.webSocket.terminate();
    await reconnecting;
    for (const page of [first, second])
      await browserExpect(page.getByText('Saved · connected', { exact: true })).toBeVisible();
    for (const page of [first, second])
      await browserExpect(page.getByLabel('Description', { exact: true })).toHaveValue(
        'Synthetic peer update',
      );
    await second.getByLabel('Description', { exact: true }).fill('Synthetic socket reconnect');
    await browserExpect(first.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic socket reconnect',
    );
    await first.getByLabel('Description', { exact: true }).fill('Synthetic peer update');
    await browserExpect(second.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic peer update',
    );
    // Re-open the second user's real session and rejoin the same persisted room.
    // This exercises fresh ticket authentication, CRDT hydration and peer edits.
    await second.reload();
    await second.getByRole('button', { name: 'Join collaborative editing', exact: true }).click();
    await browserExpect(second.getByText('Saved · connected', { exact: true })).toBeVisible();
    await mode(second, 'Rules');
    await second.getByRole('combobox', { name: 'Rule builder', exact: true }).click();
    await second.getByRole('option', { name: 'Synthetic peer update', exact: true }).click();
    await browserExpect(second.getByRole('listbox')).not.toBeVisible();
    await second.getByLabel('Description', { exact: true }).fill('Synthetic rejoined update');
    await browserExpect(first.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic rejoined update',
    );
    await first.getByLabel('Description', { exact: true }).fill('Synthetic peer update');
    await browserExpect(second.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic peer update',
    );
    // Closing a room performs its own reload after the real flush. Wait for that
    // navigation before issuing another reload, particularly in Firefox.
    for (const page of [first, second]) {
      process.stdout.write('Product audit: flushing room and awaiting navigation\n');
      await Promise.all([
        page.waitForEvent('load', { timeout: 10000 }),
        page.getByRole('button', { name: 'Save and close room', exact: true }).click(),
      ]).catch(async (error: unknown) => {
        await page.screenshot({
          path: `${evidence}/collaboration-flush-failure.png`,
          fullPage: true,
        });
        throw new Error(`${String(error)}; body: ${await page.locator('body').innerText()}`);
      });
      await browserExpect(
        page.getByRole('button', { name: 'Join collaborative editing', exact: true }),
      ).toBeVisible();
    }
    await first.reload();
    await mode(first, 'Rules');
    await first.getByRole('combobox', { name: 'Rule builder', exact: true }).click();
    await first.getByRole('option', { name: 'Synthetic peer update', exact: true }).click();
    await browserExpect(first.getByLabel('Description', { exact: true })).toHaveValue(
      'Synthetic peer update',
    );
    await browserExpect(first.getByRole('listbox')).not.toBeVisible();
    await first.screenshot({
      path: `${evidence}/collaboration-saved-reopened.png`,
      fullPage: true,
    });
    expect(failures).toEqual([]);
  });
  it('authors a delivery support story using real controls, persists bilingual text and exercises editing and preview', async () => {
    const page = await (await context('designer')).newPage();
    observe(page);
    await page.goto('/scripts');
    await page.getByRole('button', { name: 'New script', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('QA delivery support story');
    await dialog
      .getByLabel('Description', { exact: true })
      .fill('Synthetic welcome, delivery issue, resolution and confirmation');
    await dialog.getByLabel('Campaign', { exact: true }).selectOption(campaignId);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await browserExpect(page).toHaveURL(/\/scripts\/[a-f0-9-]+$/);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.getByRole('button', { name: 'Create first draft', exact: true }).click();
    await browserExpect(page.locator('[data-editor-node="home-root"]')).toBeAttached();
    const palette = page.locator('.ed-palette');
    await palette.locator('[data-component-type="heading"]').getByRole('button').last().click();
    const inspector = page.locator('.ed-inspector');
    const headingId = await inspector.locator('code').first().innerText();
    await inspector.getByLabel('Text key · TR', { exact: true }).fill('Kargo destek merkezi');
    await inspector.getByLabel('Text key · EN', { exact: true }).fill('Delivery support');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.getByRole('tab', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${headingId}"]`).getByRole('button').last().click();
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
    await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    await browserExpect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Work fullscreen', exact: true }).click();
    await browserExpect(page.locator('.ed-workspace')).toHaveAttribute('data-expanded', 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fit to canvas', exact: true }).click();
    await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
    await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
    await mode(page, 'Variables');
    await page.getByRole('button', { name: 'Add variable', exact: true }).click();
    const variable = page.getByRole('dialog');
    await variable.getByLabel('Variable name', { exact: true }).fill('trackingReference');
    await variable.getByLabel('Default value (JSON)', { exact: true }).fill('"TEST-0001"');
    await variable.getByRole('button', { name: 'Apply', exact: true }).click();
    await browserExpect(variable).not.toBeVisible();
    await mode(page, 'Rules');
    await page.getByRole('button', { name: 'Add rule', exact: true }).click();
    await page.getByLabel('Description', { exact: true }).fill('Delivery issue eligibility');
    await mode(page, 'Screen');
    await page.getByRole('tab', { name: 'Pages', exact: true }).click();
    await page.getByLabel('Page name', { exact: true }).fill('01 · Delivery welcome');
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
    await page.getByLabel('Page name', { exact: true }).fill('02 · Issue and resolution');
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await palette.locator('[data-component-type="heading"]').getByRole('button').last().click();
    await inspector.getByLabel('Text key · TR', { exact: true }).fill('Teslimat sorunu ve çözüm');
    await inspector
      .getByLabel('Text key · EN', { exact: true })
      .fill('Delivery issue and resolution');
    await browserExpect(page.getByText('Saved', { exact: true })).toBeVisible();
    await browserExpect
      .poll(async () => {
        const version = await owner.scriptVersion.findFirstOrThrow({
          where: { tenantId: tenant.tenantId, scriptId: id, number: 1 },
        });
        return version.document;
      })
      .toMatchObject({
        pages: browserExpect.arrayContaining([
          browserExpect.objectContaining({ name: '01 · Delivery welcome' }),
          browserExpect.objectContaining({ name: '02 · Issue and resolution' }),
        ]),
        variables: browserExpect.arrayContaining([
          browserExpect.objectContaining({ key: 'trackingReference', default: 'TEST-0001' }),
        ]),
        rules: browserExpect.arrayContaining([
          browserExpect.objectContaining({ description: 'Delivery issue eligibility' }),
        ]),
        i18n: {
          messages: {
            tr: browserExpect.objectContaining({
              [`editor.${headingId.replaceAll('-', '.')}.textKey`]: 'Kargo destek merkezi',
            }),
          },
        },
      });
    await page.reload();
    await page.getByRole('tab', { name: 'Layers', exact: true }).click();
    await page.getByLabel('Find component across all pages', { exact: true }).fill(headingId);
    await page
      .getByRole('region', { name: 'Component results', exact: true })
      .getByRole('button')
      .click();
    await browserExpect(inspector.getByLabel('Text key · EN', { exact: true })).toHaveValue(
      'Delivery support',
    );
    await mode(page, 'Preview / debugger');
    const frame = page.frameLocator('iframe[title="Agent runtime device preview"]');
    await browserExpect(
      frame.getByRole('heading', { name: 'Kargo destek merkezi', exact: true }).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Step', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
    const scenario = page.getByRole('dialog');
    await scenario.getByLabel('Scenario name', { exact: true }).fill('Synthetic delivery smoke');
    await scenario.getByRole('checkbox').check();
    await scenario.getByRole('button', { name: 'Save scenario', exact: true }).click();
    await browserExpect(scenario).not.toBeVisible();
    await browserExpect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/delivery-story-preview.png`, fullPage: true });
    expect(failures).toEqual([]);
  });
});
