import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { chromium, type Browser } from '@playwright/test';

import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from '../../apps/api/node_modules/testcontainers/build/index.js';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import { SESSION_STORE } from '../../apps/api/src/modules/identity/core/identity.tokens.js';
import { type SessionStore } from '../../apps/api/src/modules/identity/session/session-store.js';
import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
} from '../../apps/api/test/integration/helpers.js';
import { cookieHeader, setCookies } from '../../apps/api/test/support/http.js';
import { createTokenKit } from '../../apps/api/test/support/tokens.js';

import { evidenceFile } from './evidence.js';

import type { NestFastifyApplication } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import type { TenantFixture } from '../../apps/api/test/integration/helpers.js';

let kc: StartedTestContainer,
  app: NestFastifyApplication,
  owner: PrismaClient,
  browser: Browser,
  tenant: TenantFixture;
let issuer: string, slug: string, oidcId: string, samlId: string;
const password = randomBytes(24).toString('hex'),
  secret = randomBytes(24).toString('hex');
let origin: string, bridge: ReturnType<typeof createServer>;
let bridgeTx = '';
let captured: { status: number; location: string; session: string } | undefined;
const SESSION = '__Host-verbis_session',
  TX = '__Host-verbis_session_tx';
const results: Record<string, unknown>[] = [];
async function admin(path: string, body: unknown, method = 'POST') {
  const tokenResponse = await fetch(
    issuer.replace('/realms/v2', '/realms/master') + '/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'v2-admin',
        password,
      }),
    },
  );
  expect(tokenResponse.status).toBe(200);
  const token = (await tokenResponse.json()) as { access_token: string };
  const res = await fetch(issuer.replace('/realms/v2', '/admin/realms/v2') + path, {
    method,
    headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(res.status, await res.text()).toBeLessThan(300);
}
beforeAll(async () => {
  bridge = createServer((req, res) => {
    if (!req.url?.startsWith('/api/auth/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<p>Audit callback complete</p>');
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      void (async () => {
        const response = await app.inject({
          method: req.method as 'GET' | 'POST',
          url: req.url!.replace(/^\/api/, ''),
          headers: {
            ...(req.method === 'POST'
              ? { 'content-type': 'application/x-www-form-urlencoded' }
              : {}),
            cookie: cookieHeader({ [TX]: bridgeTx }),
          },
          ...(req.method === 'POST' ? { payload: body } : {}),
        });
        captured = {
          status: response.statusCode,
          location: String(response.headers.location),
          session: setCookies(response.headers)[SESSION] ?? '',
        };
        res.writeHead(response.statusCode, {
          ...(response.headers.location ? { location: response.headers.location } : {}),
          'content-type': 'text/html',
        });
        res.end(response.body);
      })().catch(() => {
        res.writeHead(500);
        res.end('Audit bridge failure');
      });
    });
  });
  await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', r));
  const address = bridge.address();
  if (!address || typeof address === 'string') throw new Error('No bridge address');
  origin = `http://localhost:${address.port}`;
  kc = await new GenericContainer('quay.io/keycloak/keycloak:26.8.0')
    .withEnvironment({
      KC_BOOTSTRAP_ADMIN_USERNAME: 'v2-admin',
      KC_BOOTSTRAP_ADMIN_PASSWORD: password,
    })
    .withCommand(['start-dev', '--import-realm'])
    .withCopyContentToContainer([
      {
        target: '/opt/keycloak/data/import/v2-realm.json',
        content: JSON.stringify({
          realm: 'v2',
          enabled: true,
          sslRequired: 'none',
          revokeRefreshToken: true,
          refreshTokenMaxReuse: 0,
          accessTokenLifespan: 1,
          clients: [
            {
              clientId: 'v2-bff',
              protocol: 'openid-connect',
              publicClient: false,
              secret,
              standardFlowEnabled: true,
              redirectUris: [origin + '/api/auth/oidc/callback'],
              attributes: {
                'pkce.code.challenge.method': 'S256',
                'post.logout.redirect.uris': origin + '/*',
              },
            },
          ],
          users: [
            {
              username: 'v2-saml',
              enabled: true,
              emailVerified: true,
              email: 'v2-saml@example.test',
              firstName: 'Audit',
              lastName: 'Saml',
              credentials: [{ type: 'password', value: password, temporary: false }],
            },
            {
              username: 'v2-user',
              enabled: true,
              emailVerified: true,
              email: 'v2-user@example.test',
              firstName: 'Audit',
              lastName: 'User',
              credentials: [{ type: 'password', value: password, temporary: false }],
            },
          ],
        }),
      },
    ])
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp('/realms/v2/.well-known/openid-configuration', 8080))
    .withStartupTimeout(180000)
    .start();
  issuer = `http://${kc.getHost()}:${kc.getMappedPort(8080)}/realms/v2`;
  owner = ownerPrisma();
  const kit = await createTokenKit();
  app = await startApp(
    integrationEnv(kit.jwks, {
      AUTH_APP_ORIGINS: `admin=${origin},agent=http://localhost:5174`,
      IDENTITY_EGRESS_ALLOW_HTTP_HOSTS: kc.getHost(),
      IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS: kc.getHost(),
    }),
  );
  slug = uniqueSlug('v2-keycloak');
  tenant = await createTenant(owner, kit, slug);
  const oidc = await app.inject({
    method: 'POST',
    url: '/v1/identity-providers',
    headers: await tenant.auth(),
    payload: {
      protocol: 'oidc',
      displayName: 'V2 real Keycloak',
      status: 'active',
      jitProvisioning: true,
      config: {
        vendor: 'keycloak',
        issuer,
        clientId: 'v2-bff',
        clientSecret: secret,
        roleMapping: { defaultRoles: ['agent'] },
      },
    },
  });
  expect(oidc.statusCode, oidc.body).toBe(201);
  oidcId = oidc.json<{ id: string }>().id;
  const metadata = await (await fetch(issuer + '/protocol/saml/descriptor')).text();
  const certificate = /<(?:\w+:)?X509Certificate[^>]*>([^<]+)<\//.exec(metadata)?.[1];
  expect(certificate).toBeTruthy();
  const saml = await app.inject({
    method: 'POST',
    url: '/v1/identity-providers',
    headers: await tenant.auth(),
    payload: {
      protocol: 'saml',
      displayName: 'V2 real Keycloak SAML',
      status: 'active',
      jitProvisioning: true,
      config: {
        vendor: 'keycloak',
        idpEntityId: issuer,
        ssoUrl: issuer + '/protocol/saml',
        sloUrl: issuer + '/protocol/saml',
        idpCertificates: [`-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`],
        roleMapping: { defaultRoles: ['agent'] },
      },
    },
  });
  expect(saml.statusCode, saml.body).toBe(201);
  const detail = saml.json<{ id: string; endpoints: { entityId: string; acsUrls: string[] } }>();
  samlId = detail.id;
  await admin('/clients', {
    clientId: detail.endpoints.entityId,
    protocol: 'saml',
    enabled: true,
    redirectUris: detail.endpoints.acsUrls,
    attributes: {
      'saml.client.signature': 'false',
      'saml.assertion.signature': 'true',
      'saml.server.signature': 'true',
      'saml.force.post.binding': 'true',
      saml_name_id_format: 'username',
    },
    protocolMappers: [
      {
        name: 'email',
        protocol: 'saml',
        protocolMapper: 'saml-user-property-mapper',
        config: {
          'user.attribute': 'email',
          'attribute.name': 'email',
          'attribute.nameformat': 'Basic',
        },
      },
    ],
  });
  browser = await chromium.launch({
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
  });
});
afterAll(async () => {
  writeFileSync(
    evidenceFile('keycloak-observations.json'),
    JSON.stringify({ image: 'quay.io/keycloak/keycloak:26.8.0', results }, null, 2),
  );
  await browser.close();
  await new Promise<void>((r) =>
    bridge.close(() => {
      r();
    }),
  );
  await app.close();
  await owner.$disconnect();
  await kc.stop();
});
async function roundtrip(protocol: 'oidc' | 'saml') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('requestfailed', (request) =>
    results.push({
      protocol,
      failedPath: new URL(request.url()).pathname,
      error: request.failure()?.errorText,
    }),
  );
  page.on('request', (request) => {
    const u = new URL(request.url());
    results.push({ protocol, networkPath: u.pathname, networkOrigin: u.origin });
  });
  const start = await app.inject({
    method: 'GET',
    url: `/auth/login?tenant=${slug}&app=admin&idp=${protocol === 'oidc' ? oidcId : samlId}`,
  });
  expect(start.statusCode, start.body).toBe(302);
  const tx = setCookies(start.headers)[TX] ?? '';
  let session = '';
  let callbackStatus = 0,
    callbackLocation = '';
  bridgeTx = tx;
  captured = undefined;
  await page.goto(String(start.headers.location));
  await page.locator('#username').fill(protocol === 'oidc' ? 'v2-user' : 'v2-saml');
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  try {
    await expect.poll(() => captured?.status ?? 0, { timeout: 20000 }).toBe(302);
  } catch (error) {
    results.push({
      protocol,
      callbackStatus,
      pageOrigin: new URL(page.url()).origin,
      pagePath: new URL(page.url()).pathname,
      visibleText: (await page.locator('body').innerText()).slice(0, 2000),
    });
    throw error;
  }
  callbackStatus = captured!.status;
  callbackLocation = captured!.location;
  session = captured!.session;
  results.push({ protocol, callbackStatus, callbackLocation, sessionIssued: Boolean(session) });
  expect(callbackLocation).toBe(origin + '/');
  expect(session).not.toBe('');
  const info = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: cookieHeader({ [SESSION]: session }) },
  });
  expect(info.statusCode, info.body).toBe(200);
  await context.close();
  return { session, csrf: info.json<{ csrfToken: string }>().csrfToken };
}
describe('V2 real Keycloak browser E2E', () => {
  it('OIDC authorization code PKCE real browser login, refresh rotation and logout', async () => {
    const { session, csrf } = await roundtrip('oidc');
    for (let n = 0; n < 2; n++) {
      const beforeRefresh = await app.get<SessionStore>(SESSION_STORE).load(session);
      const res = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: cookieHeader({ [SESSION]: session }) },
      });
      expect(res.statusCode, res.body).toBe(200);
      const afterRefresh = await app.get<SessionStore>(SESSION_STORE).load(session);
      expect(afterRefresh?.record.oidc?.refreshToken).toBeTruthy();
      expect(afterRefresh?.record.oidc?.refreshToken).not.toBe(
        beforeRefresh?.record.oidc?.refreshToken,
      );
    }
    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader({ [SESSION]: session }), origin, 'x-csrf-token': csrf },
      payload: {},
    });
    expect(logout.statusCode, logout.body).toBe(200);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(origin + '/**', (r) => r.fulfill({ status: 200, body: 'Logged out' }));
    await page.goto(logout.json<{ redirectUrl: string }>().redirectUrl);
    results.push({
      protocol: 'oidc',
      logoutBrowserPath: new URL(page.url()).pathname,
      logoutBrowserOrigin: new URL(page.url()).origin,
    });
    await context.close();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/auth/session',
          headers: { cookie: cookieHeader({ [SESSION]: session }) },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      await owner.auditEvent.count({
        where: { tenantId: tenant.tenantId, action: 'identity.logout.succeeded' },
      }),
    ).toBeGreaterThan(0);
  });
  it('SAML SP initiated real browser signed assertion login and RP logout', async () => {
    const { session, csrf } = await roundtrip('saml');
    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader({ [SESSION]: session }), origin, 'x-csrf-token': csrf },
      payload: {},
    });
    expect(logout.statusCode, logout.body).toBe(200);
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route('**/*', async (route) => {
      if (!route.request().url().startsWith(origin)) {
        await route.continue();
        return;
      }
      const req = route.request(),
        u = new URL(req.url());
      const res = await app.inject({
        method: req.method() as 'GET' | 'POST',
        url: u.pathname.replace(/^\/api/, '') + u.search,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        ...(req.method() === 'POST' ? { payload: req.postData() ?? '' } : {}),
      });
      results.push({ protocol: 'saml', sloStatus: res.statusCode });
      await route.fulfill({ status: 200, body: res.body });
    });
    const redirect = logout.json<{ redirectUrl?: string }>().redirectUrl;
    if (redirect) await page.goto(redirect);
    await context.close();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/auth/session',
          headers: { cookie: cookieHeader({ [SESSION]: session }) },
        })
      ).statusCode,
    ).toBe(401);
  });
});
