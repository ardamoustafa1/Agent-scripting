import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  chromium,
  firefox,
  webkit,
  expect as browserExpect,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import { exportJWK, generateKeyPair } from 'jose';

import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  expect,
  it,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import { RedisService } from '../../apps/api/src/infra/redis/redis.service.js';
import { SESSION_STORE } from '../../apps/api/src/modules/identity/core/identity.tokens.js';
import { type SessionStore } from '../../apps/api/src/modules/identity/session/session-store.js';
import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
} from '../../apps/api/test/integration/helpers.js';
import { createTokenKit } from '../../apps/api/test/support/tokens.js';
import { createHub } from '../../apps/connector-hub/src/bootstrap.js';
import { loadHubEnv } from '../../apps/connector-hub/src/env.js';
import { ConnectorSupervisor } from '../../apps/connector-hub/src/runtime/connector-supervisor.js';
import { AxeBuilder } from '../../apps/designer-web/node_modules/@axe-core/playwright/dist/index.js';
import { minimalScript } from '../../packages/script-schema/dist/fixtures/index.js';

import type { NestFastifyApplication } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import type { TLSSocket } from 'node:tls';

const root = fileURLToPath(new URL('../..', import.meta.url));
/** Shared secret the simulated TLS edge presents so the API trusts the forwarded certificate. */
/** Shared CI runners are slower than the developer hardware these render budgets were set on. */
const CI_BUDGET_FACTOR = process.env['CI'] ? 3 : 1;
const EDGE_PROXY_SECRET = randomBytes(24).toString('hex');

let owner: PrismaClient,
  app: NestFastifyApplication,
  hub: NestFastifyApplication,
  browser: Browser,
  context: BrowserContext,
  edge: TlsServer,
  vite: ChildProcess;
let tenant: Awaited<ReturnType<typeof createTenant>>,
  connectorId: string,
  origin: string,
  privateDir: string;
const errors: string[] = [];
const cleanups: (() => unknown)[] = [];
const browserCleanups: (() => Promise<unknown>)[] = [];
async function dispose(callbacks: (() => unknown)[]) {
  const failures: unknown[] = [];
  for (const cleanup of callbacks.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'QA cleanup failed');
}
const agents: Record<string, string> = {};
const measurements: {
  engine: string;
  launchMs: number;
  writebackMs: number;
  pageTransitionMs: number;
  coldRenderMs: number;
  warmRenderMs: number;
}[] = [];
const evidence = process.env['AGENT_BROWSER_EVIDENCE'] ?? `${root}/reports/verification/agent`;
mkdirSync(evidence, { recursive: true });
async function port() {
  const s = createNetServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const a = s.address();
  if (!a || typeof a === 'string') throw new Error('No port');
  await new Promise<void>((resolve) =>
    s.close(() => {
      resolve();
    }),
  );
  return a.port;
}
function certificates() {
  privateDir = mkdtempSync(`${tmpdir()}/verbis-agent-qa-`);
  cleanups.push(() => {
    rmSync(privateDir, { recursive: true, force: true });
  });
  const run = (...args: string[]) =>
    execFileSync('openssl', args, { cwd: privateDir, stdio: 'ignore' });
  run(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '1',
    '-subj',
    '/CN=Isolated QA CA',
  );
  for (const name of ['server', 'client']) {
    run(
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
      '-subj',
      `/CN=QA ${name}`,
    );
    writeFileSync(
      `${privateDir}/${name}.ext`,
      name === 'server'
        ? 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n'
        : 'extendedKeyUsage=clientAuth\n',
      { mode: 0o600 },
    );
    run(
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${name}.pem`,
      '-days',
      '1',
      '-extfile',
      `${name}.ext`,
    );
  }
}
beforeAll(async () => {
  certificates();
  owner = ownerPrisma();
  cleanups.push(() => owner.$disconnect());
  const kit = await createTokenKit();
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'qa-runtime', alg: 'EdDSA' };
  const privateJwk = { ...(await exportJWK(pair.privateKey)), kid: 'qa-runtime', alg: 'EdDSA' };
  const trusted = JSON.stringify({ keys: [publicJwk] });
  const apiJwks = JSON.stringify({
    keys: [...(JSON.parse(kit.jwks) as { keys: unknown[] }).keys, publicJwk],
  });
  const agentPort = await port(),
    hubPort = await port(),
    edgePort = await port();
  origin = `http://localhost:${agentPort}`;
  app = await startApp(
    integrationEnv(apiJwks, {
      INTERNAL_JWT_SIGNING_JWK: JSON.stringify(privateJwk),
      CONNECTOR_HUB_URL: `http://127.0.0.1:${hubPort}`,
      MTLS_CLIENT_CERT_HEADER: 'x-client-cert',
      MTLS_PROXY_SECRET: EDGE_PROXY_SECRET,
      AUTH_APP_ORIGINS: `agent=${origin},admin=http://localhost:5175,designer=http://localhost:5173`,
      SIMULATOR_ENABLED: 'true',
      OUTBOX_RELAY_ENABLED: 'true',
      EVENT_CONSUMERS_ENABLED: 'true',
      OUTBOX_POLL_INTERVAL_MS: '50',
    }),
  );
  cleanups.push(() => app.close());
  await app.listen(0, '127.0.0.1');
  const apiUrl = await app.getUrl();
  // This isolated edge authenticates the real TLS client and replaces any supplied cert header.
  edge = createTlsServer(
    {
      key: readFileSync(`${privateDir}/server.key`),
      cert: readFileSync(`${privateDir}/server.pem`),
      ca: readFileSync(`${privateDir}/ca.pem`),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (request, response) => {
      void (async () => {
        const socket = request.socket as TLSSocket;
        const certificate = socket.getPeerCertificate();
        if (!socket.authorized || Object.keys(certificate).length === 0) {
          response.writeHead(403).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers))
          if (
            value &&
            ![
              'host',
              'connection',
              'content-length',
              'x-client-cert',
              'x-verbis-mtls-proxy-secret',
            ].includes(key)
          )
            headers.set(key, Array.isArray(value) ? value.join(',') : value);
        headers.set('x-verbis-mtls-proxy-secret', EDGE_PROXY_SECRET);
        headers.set(
          'x-client-cert',
          encodeURIComponent(new X509Certificate(certificate.raw).toString()),
        );
        const result = await fetch(`${apiUrl}${request.url ?? '/'}`, {
          method: request.method ?? 'GET',
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          redirect: 'manual',
        });
        response.writeHead(result.status, {
          'content-type': result.headers.get('content-type') ?? 'application/json',
        });
        response.end(Buffer.from(await result.arrayBuffer()));
      })().catch(() => {
        response.writeHead(502).end();
      });
    },
  );
  cleanups.push(
    () =>
      new Promise<void>((resolve) =>
        edge.close(() => {
          resolve();
        }),
      ),
  );
  await new Promise<void>((resolve) => edge.listen(edgePort, '127.0.0.1', resolve));
  const tenantSlug = uniqueSlug('agent-e2e');
  tenant = await createTenant(owner, kit, tenantSlug, { allowedOrigins: [origin] });
  await owner.user.update({
    where: { id: tenant.adminId },
    data: { ctiIdentities: [{ platform: 'generic', id: 'qa-agent' }], locale: 'en' },
  });
  const client = await owner.serviceClient.create({
    data: {
      tenantId: tenant.tenantId,
      name: 'Isolated QA hub',
      authMethod: 'tls_client_auth',
      certificateThumbprint: createHash('sha256')
        .update(new X509Certificate(readFileSync(`${privateDir}/client.pem`)).raw)
        .digest('base64url'),
      scopes: ['read:Connector', 'update:Connector', 'create:Session'],
      status: 'active',
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  connectorId = (
    await owner.connector.create({
      data: {
        tenantId: tenant.tenantId,
        adapterType: 'generic',
        platform: 'generic',
        config: { kind: 'simulator' },
        status: 'active',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  ).id;
  const headers = await tenant.auth();
  const document = minimalScript();
  document.i18n.defaultLocale = 'en';
  document.pages.push({
    id: 'confirmation',
    name: 'Confirmation',
    layout: {
      id: 'confirmation-root',
      type: 'box',
      children: [
        {
          id: 'confirmation-next',
          type: 'button',
          props: { labelKey: 'common.next' },
          events: { onPress: [{ type: 'next' }] },
        },
      ],
    },
  });
  document.flow.nodes.splice(1, 0, { id: 'n-confirmation', type: 'page', page: 'confirmation' });
  document.flow.edges = [
    { id: 'e-home-confirmation', from: 'n-home', to: 'n-confirmation' },
    { id: 'e-confirmation-end', from: 'n-confirmation', to: 'n-end' },
  ];
  document.variables = [
    { key: 'qaResult', type: 'string', scope: 'session', persist: true, classification: 'public' },
  ];
  document.i18n.messages['en']!['qa.result'] = 'QA result';
  document.pages[0]!.layout.children!.unshift({
    id: 'qa-result',
    type: 'textInput',
    props: { labelKey: 'qa.result' },
    bindings: [{ variable: 'qaResult' }],
    requiredWhen: { $expr: 'true' },
  });
  document.testScenarios = [
    {
      id: 'ready',
      name: 'Ready runtime',
      synthetic: true,
      context: {},
      steps: [
        { type: 'variable', variable: 'qaResult', value: 'QA' },
        { type: 'event', node: 'btn-next', event: 'onPress' },
      ],
      expected: { page: 'confirmation', variables: { qaResult: 'QA' } },
    },
  ];
  const script = await app.inject({
    method: 'POST',
    url: '/v1/scripts',
    headers,
    payload: { name: 'Agent real chain' },
  });
  expect(script.statusCode, script.body).toBe(201);
  const id = script.json<{ id: string }>().id;
  const version = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${id}/versions`,
    headers,
    payload: { document, screens: [] },
  });
  expect(version.statusCode, version.body).toBe(201);
  const vid = version.json<{ id: string }>().id;
  for (const [path, actor, payload] of [
    ['submit', headers, { semver: '1.0.0', changeNote: 'Synthetic QA' }],
    ['reviews', await tenant.auth(tenant.designerId), { decision: 'approved' }],
    ['publish', await tenant.auth(tenant.designerId), {}],
  ] as const) {
    const result = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${id}/versions/1/${path}`,
      headers: actor,
      payload,
    });
    expect(result.statusCode, result.body).toBe(200);
  }
  const campaign = await app.inject({
    method: 'POST',
    url: '/v1/campaigns',
    headers,
    payload: {
      name: 'Agent QA',
      status: 'active',
      channels: ['voice'],
      defaultLocale: 'en',
      outcomeSet: [
        {
          code: 'SUCCESS',
          category: 'success',
          label: 'Success',
          subCodes: [],
          requiresNote: true,
          requiredFields: ['qaResult'],
        },
      ],
      externalMappings: [{ platform: 'generic', kind: 'queue', externalId: 'qa-queue' }],
    },
  });
  expect(campaign.statusCode, campaign.body).toBe(201);
  const assignment = await app.inject({
    method: 'POST',
    url: '/v1/assignments',
    headers,
    payload: {
      scriptId: id,
      campaignId: campaign.json<{ id: string }>().id,
      versionPolicy: 'pinned',
      pinnedVersionId: vid,
    },
  });
  expect(assignment.statusCode, assignment.body).toBe(201);
  const agentRole = await owner.role.findFirstOrThrow({
    where: { tenantId: tenant.tenantId, name: 'agent' },
  });
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    const user = await owner.user.create({
      data: {
        tenantId: tenant.tenantId,
        email: `${engine}@qa.test`,
        displayName: `QA ${engine}`,
        status: 'active',
        locale: 'en',
        ctiIdentities: [],
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
    await owner.userRole.create({
      data: {
        tenantId: tenant.tenantId,
        userId: user.id,
        roleId: agentRole.id,
        scope: { campaignIds: [campaign.json<{ id: string }>().id] },
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
    const mapping = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${user.id}/connector-mapping`,
      headers: await tenant.auth(),
      payload: { platform: ' GENERIC ', platformUserId: `qa-${engine}` },
    });
    expect(mapping.statusCode, mapping.body).toBe(200);
    agents[engine] = user.id;
  }
  hub = await createHub(
    loadHubEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      HUB_API_URL: `https://localhost:${edgePort}`,
      HUB_TENANTS: JSON.stringify([{ slug: tenantSlug, clientId: client.id }]),
      HUB_TRUSTED_JWKS: trusted,
      HUB_CLIENT_CERT_FILE: `${privateDir}/client.pem`,
      HUB_CLIENT_KEY_FILE: `${privateDir}/client.key`,
      HUB_CA_FILE: `${privateDir}/ca.pem`,
      SIMULATOR_ENABLED: 'true',
    }),
    { autoStart: false },
    false,
  );
  cleanups.push(() => hub.close());
  await hub.init();
  await hub.listen(hubPort, '127.0.0.1');
  await hub.get(ConnectorSupervisor).sync();
  vite = spawn('pnpm', ['exec', 'vite', '--port', String(agentPort)], {
    cwd: `${root}/apps/agent-web`,
    env: { ...process.env, API_INTERNAL_URL: apiUrl, AGENT_WEB_PORT: String(agentPort) },
    stdio: 'ignore',
  });
  cleanups.push(() => {
    vite.kill('SIGTERM');
  });
  await browserExpect
    .poll(
      async () => {
        try {
          return (await fetch(`${origin}/health`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .toBe(true);
});
afterAll(async () => {
  await dispose(browserCleanups);
  await dispose(cleanups);
});
beforeEach(async () => {
  // Independent browser cases share only this disposable Redis; production limits stay enabled.
  const redis = app.get(RedisService).client;
  const keys = await redis.keys('verbis:api:rl:*');
  if (keys.length) await redis.del(...keys.map((key) => key.slice('verbis:api:'.length)));
});
afterEach(async () => {
  await dispose(browserCleanups);
});
it.each(['chromium', 'firefox', 'webkit'] as const)(
  '%s: real simulator → mTLS → launch → runtime → hub ACK',
  async (engine) => {
    errors.length = 0;
    browser = await { chromium, firefox, webkit }[engine].launch();
    const currentBrowser = browser;
    browserCleanups.push(() => currentBrowser.close());
    context = await browser.newContext({ baseURL: origin, locale: 'en-US' });
    const currentContext = context;
    browserCleanups.push(() => currentContext.close());
    const session = await app.get<SessionStore>(SESSION_STORE).create(
      {
        tenantId: tenant.tenantId,
        userId: agents[engine]!,
        kind: 'sso',
        protocol: 'oidc',
        app: 'agent',
        ip: '127.0.0.1',
        userAgent: 'QA',
      },
      { idleTimeoutSeconds: 600, absoluteTimeoutSeconds: 3600, maxConcurrent: 10, onLimit: 'deny' },
    );
    if (engine === 'webkit' && process.platform === 'linux') {
      // WebKit on Linux does not treat http://localhost as a secure context, so it drops the
      // Secure __Host- cookie; send the same cookie as a request header instead.
      await context.setExtraHTTPHeaders({ cookie: `__Host-verbis_session=${session.token}` });
    } else {
      await context.addCookies([
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
    }

    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const requests: string[] = [];
    const writer = { tabId: '', writeToken: '' };
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.endsWith('/attach') && response.status() === 201) {
        void response
          .json()
          .then((body: { writeToken?: string }) => {
            if (body.writeToken) {
              writer.writeToken = body.writeToken;
              writer.tabId = (response.request().postDataJSON() as { tabId: string }).tabId;
            }
          })
          .catch(() => undefined);
      }
      if (path.startsWith('/api/')) {
        requests.push(`${path}: ${response.status()}`);
        if (response.status() >= 400)
          void response
            .json()
            .then((body: { code?: string }) => requests.push(`error: ${body.code}`))
            .catch(() => undefined);
      }
    });
    await page.goto('/');
    try {
      await browserExpect(page.getByText(/Waiting for an interaction/)).toBeVisible({
        timeout: 20000,
      });
    } catch (error) {
      throw new Error(
        `Agent shell did not render: requests=${requests.join(', ')}; pageErrors=${errors.join(' | ')}; cookies=${JSON.stringify((await context.cookies()).map((c) => c.name))}; UI: ${(
          await page
            .locator('body')
            .innerText()
            .catch(() => '')
        ).slice(0, 400)}`,
        { cause: error },
      );
    }
    try {
      await browserExpect(
        page.getByText('Connector channel connected', { exact: true }),
      ).toBeVisible({ timeout: 10000 });
    } catch {
      throw new Error(
        `Launch connection failed: ${requests.join(', ')}; UI: ${await page.locator('body').innerText()}`,
      );
    }
    const sessionResponse = await page.request.get('/api/auth/session');
    const { csrfToken } = (await sessionResponse.json()) as { csrfToken: string };
    expect(csrfToken).toBeTruthy();
    await browserExpect(
      page.getByRole('button', { name: 'Live monitoring', exact: true }),
    ).toHaveCount(0);
    const interactionCount = await owner.interaction.count({
      where: { tenantId: tenant.tenantId },
    });
    const intentCount = await owner.launchIntent.count({ where: { tenantId: tenant.tenantId } });
    const launchStarted = performance.now();
    const platformAgentId = engine === 'firefox' ? 'qa-email-firefox' : `qa-${engine}`;
    const connected = await app.inject({
      method: 'POST',
      url: `/v1/simulator/connectors/${connectorId}/interactions`,
      headers: await tenant.auth(),
      payload: {
        channel: 'voice',
        agentPlatformUserId: platformAgentId,
        ...(engine === 'firefox' ? { agentEmail: 'firefox@qa.test' } : {}),
        queue: 'qa-queue',
        customerName: 'Synthetic customer',
        autoConnect: true,
      },
    });
    expect(connected.statusCode, connected.body).toBe(201);
    const capacity = await app.inject({
      method: 'POST',
      url: `/v1/simulator/connectors/${connectorId}/interactions`,
      headers: await tenant.auth(),
      payload: { channel: 'voice', agentPlatformUserId: platformAgentId, autoConnect: true },
    });
    expect(capacity.statusCode, capacity.body).toBe(409);
    expect(capacity.headers['content-type']).toContain('application/problem+json');
    const capacityProblem = capacity.json<{
      code: string;
      correlationId: string;
      errors: { path: string }[];
    }>();
    expect(capacityProblem.code).toBe('VERBIS_CONNECTOR_CONCURRENCY_LIMIT');
    expect(capacityProblem.correlationId.length).toBeGreaterThan(0);
    expect(capacityProblem.errors[0]?.path).toBe('/connector');
    const call = connected.json<{ platformInteractionId: string }>();
    await browserExpect
      .poll(() => owner.interaction.count({ where: { tenantId: tenant.tenantId } }), {
        timeout: 15000,
      })
      .toBe(interactionCount + 1);
    await browserExpect
      .poll(() => owner.launchIntent.count({ where: { tenantId: tenant.tenantId } }), {
        timeout: 15000,
      })
      .toBe(intentCount + 1);
    try {
      await browserExpect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/, { timeout: 15000 });
    } catch {
      throw new Error(
        `Launch failed: ${requests.join(', ')}; intents: ${JSON.stringify(await owner.launchIntent.findMany({ where: { tenantId: tenant.tenantId }, select: { state: true } }))}`,
      );
    }
    await browserExpect(
      page.getByRole('heading', { name: 'Synthetic customer', exact: true }),
    ).toBeVisible();
    await browserExpect(
      page.getByRole('tab', { name: /Voice · Synthetic customer/ }),
    ).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    await browserExpect(
      page.getByRole('button', { name: 'Next', exact: true }).last(),
    ).toBeEnabled();
    const launchMs = performance.now() - launchStarted;
    expect(launchMs).toBeLessThan(10000);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const size = await page.evaluate<{ width: number; scroll: number }>(
        '({width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth})',
      );
      expect(size.scroll, `${engine} active ${width}px overflow`).toBeLessThanOrEqual(
        size.width + 1,
      );
      await page.screenshot({ path: `${evidence}/${engine}-active-${width}.png`, fullPage: true });
    }
    expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
    const observer = await context.newPage();
    await observer.goto(`/s/${id}`);
    await browserExpect(observer.locator('.ag-runtime[data-page-id]')).toBeVisible();
    const coldRenderMs = await observer.evaluate<number>('performance.now()');
    expect(coldRenderMs).toBeLessThan(1500 * CI_BUDGET_FACTOR);
    await observer.reload();
    await browserExpect(observer.locator('.ag-runtime[data-page-id]')).toBeVisible();
    const warmRenderMs = await observer.evaluate<number>('performance.now()');
    expect(warmRenderMs).toBeLessThan(500 * CI_BUDGET_FACTOR);
    await browserExpect(
      observer.getByText('This session is open in another tab or available for observation only.', {
        exact: true,
      }),
    ).toBeVisible();
    await browserExpect(
      observer.getByRole('button', { name: 'Next', exact: true }).last(),
    ).toBeDisabled();
    await observer.screenshot({ path: `${evidence}/${engine}-second-tab.png`, fullPage: true });
    await observer.close();

    await browserExpect.poll(() => writer.writeToken.length).toBe(43);
    for (const paused of [true, false]) {
      const current = await page.request.get(`/api/v1/sessions/${id}/state`);
      const sequence = ((await current.json()) as { sequence: number }).sequence;
      const recording = await page.request.post(`/api/v1/sessions/${id}/recording`, {
        headers: { 'x-csrf-token': csrfToken, origin },
        data: { ...writer, expectedSequence: sequence, paused },
      });
      expect(recording.status(), await recording.text()).toBe(201);
      await browserExpect
        .poll(
          async () => {
            const state = await app.inject({
              method: 'GET',
              url: `/v1/simulator/connectors/${connectorId}`,
              headers: await tenant.auth(),
            });
            return state
              .json<{ commands: { command: string; platformInteractionId: string }[] }>()
              .commands.some(
                (command) =>
                  command.command === (paused ? 'pauseRecording' : 'resumeRecording') &&
                  command.platformInteractionId === call.platformInteractionId,
              );
          },
          { timeout: 10000 },
        )
        .toBe(true);
    }
    for (const action of ['hold', 'resume'] as const) {
      const changed = await app.inject({
        method: 'POST',
        url: `/v1/simulator/connectors/${connectorId}/interactions/${call.platformInteractionId}/actions`,
        headers: await tenant.auth(),
        payload: { action },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      await browserExpect
        .poll(
          async () => {
            const state = await page.request.get(`/api/v1/sessions/${id}/state`);
            return ((await state.json()) as { state: string }).state;
          },
          { timeout: 10000 },
        )
        .toBe(action === 'hold' ? 'paused' : 'active');
      if (action === 'hold') {
        await browserExpect(
          page.getByText('Interaction is on hold.', { exact: true }),
        ).toBeVisible();
        await browserExpect(
          page.getByRole('button', { name: 'Next', exact: true }).last(),
        ).toBeDisabled();
      } else
        await browserExpect(
          page.getByRole('button', { name: 'Next', exact: true }).last(),
        ).toBeEnabled();
    }
    await page.getByRole('textbox', { name: 'QA result', exact: true }).fill(`Persisted ${engine}`);
    await browserExpect
      .poll(
        async () => {
          const response = await page.request.get(`/api/v1/sessions/${id}/state`);
          return ((await response.json()) as { snapshot: { variables: { qaResult: string } } })
            .snapshot.variables.qaResult;
        },
        { timeout: 10000 },
      )
      .toBe(`Persisted ${engine}`);
    // Same 100 ms real page-transition budget as agent-web/e2e/performance.spec.ts.
    // No API routes are mocked; timer starts before the native runtime Next click.
    const pageTransitionMs = await page.evaluate<number>(`new Promise((resolve, reject) => {
      const field = document.querySelector('.ag-runtime[data-page-id]');
      const button = document.querySelector('[data-agent-next]');
      if (!field || !button || button.disabled) { reject(new Error('Runtime is not editable')); return; }
      const prior = field.getAttribute('data-page-id'), started = performance.now();
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Page did not advance')); }, 5000);
      const observer = new MutationObserver(() => {
        if (field.getAttribute('data-page-id') !== prior) {
          clearTimeout(timeout); observer.disconnect(); resolve(performance.now() - started);
        }
      });
      observer.observe(field, { attributes: true, attributeFilter: ['data-page-id'] });
      button.click();
    })`);
    expect(pageTransitionMs).toBeLessThan(100);
    await browserExpect(page.locator('.ag-runtime[data-page-id="confirmation"]')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).last().click();
    await browserExpect(page.getByRole('heading', { name: 'Wrap up', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Disposition', exact: true }).click();
    await page.getByRole('option', { name: 'Success', exact: true }).click();
    await browserExpect(
      page.getByRole('button', { name: 'Submit outcome', exact: true }),
    ).toBeDisabled();
    await page.getByLabel('Notes', { exact: true }).fill('Synthetic persisted outcome');
    expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
    const writebackStarted = performance.now();
    await page.getByRole('button', { name: 'Submit outcome', exact: true }).click();
    await browserExpect
      .poll(
        async () => {
          const response = await page.request.get(`/api/v1/sessions/${id}/desktop`);
          expect(response.status()).toBe(200);
          return ((await response.json()) as { writeback: string }).writeback;
        },
        { timeout: 30000 },
      )
      .toBe('success');
    const writebackMs = performance.now() - writebackStarted;
    expect(writebackMs).toBeLessThan(10000);
    await page.reload();
    await browserExpect(page.getByRole('heading', { name: 'Interaction completed' })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${engine}-completed.png`, fullPage: true });
    expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
    const snapshot = await app.inject({
      method: 'GET',
      url: `/v1/simulator/connectors/${connectorId}`,
      headers: await tenant.auth(),
    });
    const commands = snapshot.json<{
      commands: { command: string; platformInteractionId: string }[];
    }>().commands;
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'writeAttributes',
          platformInteractionId: call.platformInteractionId,
          payload: { attributes: { qaResult: `Persisted ${engine}` } },
        }),
      ]),
    );
    expect(
      commands.some(
        (command) =>
          command.command === 'setWrapUp' &&
          command.platformInteractionId === call.platformInteractionId,
      ),
    ).toBe(true);
    expect(await owner.outcome.count({ where: { sessionId: id, code: 'SUCCESS' } })).toBe(1);
    expect(errors).toEqual([]);
    const ended = await app.inject({
      method: 'POST',
      url: `/v1/simulator/connectors/${connectorId}/interactions/${call.platformInteractionId}/actions`,
      headers: await tenant.auth(),
      payload: { action: 'end' },
    });
    expect(ended.statusCode, ended.body).toBe(200);
    measurements.push({
      engine,
      launchMs: Math.round(launchMs),
      coldRenderMs: Math.round(coldRenderMs),
      warmRenderMs: Math.round(warmRenderMs),
      pageTransitionMs: Math.round(pageTransitionMs * 100) / 100,
      writebackMs: Math.round(writebackMs),
    });
    writeFileSync(`${evidence}/measurements.json`, JSON.stringify(measurements, null, 2) + '\n');
  },
);
