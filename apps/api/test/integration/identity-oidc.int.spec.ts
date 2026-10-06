import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cookieHeader, rawSetCookies, setCookies } from '../support/http.js';
import { MockOidcProvider } from '../support/mock-oidc-provider.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
  type TenantFixture,
} from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

// Each test models a separate browser IP; keep production rate limits enabled.
let browserNumber = 0;
let browserIp = '192.0.2.1';
beforeEach(() => {
  browserIp = `192.0.2.${++browserNumber}`;
});

const ADMIN_ORIGIN = 'http://localhost:5175';
const SESSION = '__Host-verbis_session';
const TX = '__Host-verbis_session_tx';

let app: NestFastifyApplication;
let owner: PrismaClient;
let kit: TokenKit;
let idp: MockOidcProvider;
let tenant: TenantFixture;
let slug: string;
let idpId: string;

async function createIdp(
  overrides: Record<string, unknown> = {},
  config: Record<string, unknown> = {},
) {
  const res = await app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: '/v1/identity-providers',
    headers: await tenant.auth(),
    payload: {
      protocol: 'oidc',
      displayName: 'Mock IdP',
      status: 'active',
      jitProvisioning: true,
      ...overrides,
      config: {
        vendor: 'keycloak',
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
        roleMapping: {
          defaultRoles: ['agent'],
          rules: [{ claim: 'groups', equals: 'verbis-admins', roles: ['tenant_admin'] }],
        },
        ...config,
      },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{
    id: string;
    config: Record<string, unknown>;
    endpoints: Record<string, unknown>;
  }>();
}

/** Full browser round trip: /auth/login → IdP → /auth/oidc/callback. Returns the session cookie. */
async function login(options: { idp?: string; returnTo?: string } = {}) {
  const start = await app.inject({
    remoteAddress: browserIp,
    method: 'GET',
    url: `/auth/login?tenant=${slug}&app=admin&idp=${options.idp ?? idpId}&returnTo=${encodeURIComponent(options.returnTo ?? '/home')}`,
  });
  expect(start.statusCode, start.body).toBe(302);
  const tx = setCookies(start.headers)[TX];
  expect(tx).toBeDefined();
  const location = String(start.headers.location);
  expect(location.startsWith(`${idp.issuer}/authorize?`)).toBe(true);
  const auth = idp.authorize(location);
  expect(auth.redirectUri).toBe(`${ADMIN_ORIGIN}/api/auth/oidc/callback`);
  const callback = await app.inject({
    remoteAddress: browserIp,
    method: 'GET',
    url: `/auth/oidc/callback?code=${auth.code}&state=${auth.state}`,
    headers: { cookie: cookieHeader({ [TX]: tx ?? '' }) },
  });
  expect(callback.statusCode, callback.body).toBe(302);
  return {
    callback,
    session: setCookies(callback.headers)[SESSION],
    sid: auth.sid,
    state: auth.state,
    tx: tx ?? '',
  };
}

async function sessionInfo(session: string) {
  return app.inject({
    remoteAddress: browserIp,
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: cookieHeader({ [SESSION]: session }) },
  });
}

beforeAll(async () => {
  owner = ownerPrisma();
  kit = await createTokenKit();
  idp = new MockOidcProvider();
  await idp.start();
  app = await startApp(
    integrationEnv(kit.jwks, {
      IDENTITY_EGRESS_ALLOW_HTTP_HOSTS: '127.0.0.1',
      IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS: '127.0.0.1',
    }),
  );
  slug = uniqueSlug('oidc');
  tenant = await createTenant(owner, kit, slug);
  idpId = (await createIdp({ domains: [`${slug}.example.com`] })).id;
});

afterAll(async () => {
  await app.close();
  await idp.stop();
  await owner.$disconnect();
});

describe('OIDC login (Authorization Code + PKCE, BFF session)', () => {
  it('never returns the client secret and lists the URLs to register', async () => {
    const res = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/v1/identity-providers/${idpId}`,
      headers: await tenant.auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(idp.clientSecret);
    expect(res.json()).toMatchObject({
      config: { clientSecretSet: true },
      endpoints: {
        redirectUris: expect.arrayContaining([`${ADMIN_ORIGIN}/api/auth/oidc/callback`]) as unknown,
      },
    });
  });

  it('discovers the IdP by email domain and by tenant slug', async () => {
    const byEmail = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/auth/discover',
      payload: { email: `ada@${slug}.example.com` },
    });
    expect(byEmail.json()).toEqual({
      tenant: slug,
      providers: [{ id: idpId, displayName: 'Mock IdP', protocol: 'oidc' }],
    });
    const bySlug = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/auth/discover',
      payload: { tenant: slug },
    });
    expect(bySlug.json<{ providers: unknown[] }>().providers.length).toBeGreaterThan(0);
    const unknown = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/auth/discover',
      payload: { email: 'x@nowhere.example' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'VERBIS_AUTH_TENANT_UNKNOWN' });
  });

  it('JIT-provisions the user, maps group claims to roles, and sets only an httpOnly cookie', async () => {
    idp.user = {
      sub: 'sub-ada',
      email: `ada@${slug}.example.com`,
      email_verified: true,
      name: 'Ada',
      groups: ['verbis-admins'],
    };
    const { callback, session } = await login({ returnTo: '/settings' });
    expect(callback.headers.location).toBe(`${ADMIN_ORIGIN}/settings`);
    const cookie =
      rawSetCookies(callback.headers).find((line) => line.startsWith(`${SESSION}=`)) ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(callback.body).not.toMatch(/eyJ/); // no token in the response

    const info = await sessionInfo(session ?? '');
    expect(info.statusCode).toBe(200);
    expect(info.body).not.toMatch(/eyJ/);
    const me = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: '/v1/authz/me',
      headers: { cookie: cookieHeader({ [SESSION]: session ?? '' }) },
    });
    expect(me.json<{ permissions: string[] }>().permissions).toContain('manage:all');

    const user = await owner.user.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, email: `ada@${slug}.example.com` },
    });
    const roles = await owner.userRole.findMany({
      where: { userId: user.id, deletedAt: null },
      include: { role: true },
    });
    expect(roles.map((r) => `${r.role.name}/${r.source}`).sort()).toEqual([
      `agent/claims:${idpId}`,
      `tenant_admin/claims:${idpId}`,
    ]);
    const actions = (
      await owner.auditEvent.findMany({
        where: { tenantId: tenant.tenantId },
        orderBy: { seq: 'asc' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'identity.user.provisioned',
        'identity.userIdentity.linked',
        'identity.userRole.granted',
        'identity.login.succeeded',
      ]),
    );
    const outbox = await owner.outboxEvent.findMany({
      where: { tenantId: tenant.tenantId, eventType: 'verbis.identity.session.started.v1' },
    });
    expect(outbox.length).toBeGreaterThan(0);
  });

  it('removes claim roles when the IdP stops asserting the group, keeps manual roles', async () => {
    const user = await owner.user.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, email: `ada@${slug}.example.com` },
    });
    const set = await app.inject({
      remoteAddress: browserIp,
      method: 'PUT',
      url: `/v1/users/${user.id}/roles`,
      headers: await tenant.auth(),
      payload: { roles: ['auditor'] },
    });
    expect(set.statusCode, set.body).toBe(200);
    idp.user = { ...idp.user, groups: [] };
    await login();
    const roles = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/v1/users/${user.id}/roles`,
      headers: await tenant.auth(),
    });
    expect(roles.json<{ roles: { name: string; source: string }[] }>().roles).toEqual([
      { name: 'agent', source: `claims:${idpId}` },
      { name: 'auditor', source: 'manual' },
    ]);
    const revoked = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'identity.userRole.revoked' },
    });
    expect(revoked).not.toBeNull();
    idp.user = { ...idp.user, groups: ['verbis-admins'] };
  });

  it('a callback cannot be replayed and is bound to the browser that started it', async () => {
    const first = await login();
    const replay = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/auth/oidc/callback?code=x&state=${first.state}`,
      headers: { cookie: cookieHeader({ [TX]: first.tx }) },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.headers['content-type']).toMatch(/problem\+json/);

    const start = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/auth/login?tenant=${slug}&app=admin&idp=${idpId}`,
    });
    const auth = idp.authorize(String(start.headers.location));
    const otherBrowser = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/auth/oidc/callback?code=${auth.code}&state=${auth.state}`,
      headers: { cookie: cookieHeader({ [TX]: 'attacker-browser-transaction-cookie-value' }) },
    });
    expect(otherBrowser.statusCode).toBe(302);
    expect(otherBrowser.headers.location).toBe(`${ADMIN_ORIGIN}/?authError=login_failed`);
    expect(setCookies(otherBrowser.headers)[SESSION]).toBeUndefined();
  });

  it('rejects an id_token with the wrong nonce/state and audits the failure', async () => {
    const start = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/auth/login?tenant=${slug}&app=admin&idp=${idpId}`,
    });
    const tx = setCookies(start.headers)[TX] ?? '';
    const auth = idp.authorize(
      String(start.headers.location).replace(/nonce=[^&]+/, 'nonce=forged'),
    );
    const res = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/auth/oidc/callback?code=${auth.code}&state=${auth.state}`,
      headers: { cookie: cookieHeader({ [TX]: tx }) },
    });
    expect(res.headers.location).toBe(`${ADMIN_ORIGIN}/?authError=login_failed`);
    const failed = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'identity.login.failed' },
      orderBy: { seq: 'desc' },
    });
    expect(failed).toMatchObject({
      outcome: 'failure',
      diff: { after: { reason: 'protocol_error', protocol: 'oidc' } },
    });
  });

  it('refuses unknown users when JIT provisioning is off', async () => {
    const strict = await createIdp({ displayName: 'Strict', jitProvisioning: false });
    idp.user = { sub: 'sub-unknown', email: `nobody@${slug}.example.com`, email_verified: true };
    const { callback } = await login({ idp: strict.id });
    expect(callback.headers.location).toBe(`${ADMIN_ORIGIN}/?authError=not_provisioned`);
    const failed = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'identity.login.failed', outcome: 'denied' },
    });
    expect(failed?.targetId).toBe(strict.id);
  });

  it('links an existing (SCIM-provisioned) user by verified email, never by unverified email', async () => {
    const strict = await createIdp({ displayName: 'Linker', jitProvisioning: false });
    idp.user = {
      sub: 'sub-designer-unverified',
      email: `designer@${slug}.test`,
      email_verified: false,
    };
    expect((await login({ idp: strict.id })).callback.headers.location).toContain(
      'authError=not_provisioned',
    );
    idp.user = { sub: 'sub-designer', email: `designer@${slug}.test`, email_verified: true };
    const { session } = await login({ idp: strict.id });
    expect((await sessionInfo(session ?? '')).json()).toMatchObject({
      user: { id: tenant.designerId },
    });
  });
});

describe('CSRF protection for cookie sessions', () => {
  it('requires X-CSRF-Token and an allowed Origin on state-changing requests', async () => {
    idp.user = {
      sub: 'sub-ada',
      email: `ada@${slug}.example.com`,
      email_verified: true,
      groups: ['verbis-admins'],
    };
    const { session } = await login();
    const csrf = (await sessionInfo(session ?? '')).json<{ csrfToken: string }>().csrfToken;
    const cookie = cookieHeader({ [SESSION]: session ?? '' });
    const payload = { name: `CSRF ${String(Date.now())}`, channels: ['voice'] };

    const noToken = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/campaigns',
      headers: { cookie, origin: ADMIN_ORIGIN },
      payload,
    });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json()).toMatchObject({ code: 'VERBIS_AUTH_CSRF_FAILED' });

    const evil = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/campaigns',
      headers: { cookie, origin: 'https://evil.example', 'x-csrf-token': csrf },
      payload,
    });
    expect(evil.statusCode).toBe(403);

    const form = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/campaigns',
      headers: {
        cookie,
        origin: ADMIN_ORIGIN,
        'x-csrf-token': csrf,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'name=x',
    });
    expect(form.statusCode).toBe(403);

    const ok = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/campaigns',
      headers: { cookie, origin: ADMIN_ORIGIN, 'x-csrf-token': csrf },
      payload,
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

describe('session lifecycle', () => {
  it('refreshes IdP tokens with rotation and ends the session when the IdP refuses', async () => {
    idp.accessTokenLifetime = 1; // expired immediately (30 s leeway)
    const { session } = await login();
    const before = idp.grants.filter((g) => g === 'refresh_token').length;
    expect((await sessionInfo(session ?? '')).statusCode).toBe(200);
    expect((await sessionInfo(session ?? '')).statusCode).toBe(200);
    expect(idp.grants.filter((g) => g === 'refresh_token').length).toBe(before + 2);

    idp.revokeRefreshTokens();
    expect((await sessionInfo(session ?? '')).statusCode).toBe(401);
    expect((await sessionInfo(session ?? '')).statusCode).toBe(401);
    const revoked = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'identity.session.revoked' },
      orderBy: { seq: 'desc' },
    });
    expect(revoked?.diff).toMatchObject({ after: { reason: 'refresh_rejected' } });
    idp.accessTokenLifetime = 300;
  });

  it('back-channel logout ends the IdP session’s Verbis sessions; replays are refused', async () => {
    const { session, sid } = await login();
    const token = await idp.logoutToken({ sid });
    const url = `/auth/oidc/${slug}/${idpId}/backchannel-logout`;
    const res = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `logout_token=${token}`,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await sessionInfo(session ?? '')).statusCode).toBe(401);
    const replay = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `logout_token=${token}`,
    });
    expect(replay.statusCode).toBe(400);
    for (const bad of [
      await idp.logoutToken({ sid, nonce: 'n' }),
      await idp.logoutToken({ sid, events: {} }),
      await idp.logoutToken({ sid }, { audience: 'other-client' }),
      'not-a-jwt',
    ]) {
      const rejected = await app.inject({
        remoteAddress: browserIp,
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `logout_token=${bad}`,
      });
      expect(rejected.statusCode).toBe(400);
    }
  });

  it('front-channel logout by iss + sid, framable only by the IdP', async () => {
    const { session, sid } = await login();
    const res = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: `/auth/oidc/${slug}/${idpId}/frontchannel-logout?iss=${encodeURIComponent(idp.issuer)}&sid=${sid}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain(`frame-ancestors ${idp.issuer}`);
    expect((await sessionInfo(session ?? '')).statusCode).toBe(401);
  });

  it('RP-initiated logout clears the cookie and returns the IdP end-session URL', async () => {
    const { session } = await login();
    const csrf = (await sessionInfo(session ?? '')).json<{ csrfToken: string }>().csrfToken;
    const res = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: cookieHeader({ [SESSION]: session ?? '' }),
        origin: ADMIN_ORIGIN,
        'x-csrf-token': csrf,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const redirect = new URL(res.json<{ redirectUrl: string }>().redirectUrl);
    expect(redirect.origin + redirect.pathname).toBe(`${idp.issuer}/logout`);
    expect(redirect.searchParams.get('id_token_hint')).toMatch(/^eyJ/);
    expect(redirect.searchParams.get('post_logout_redirect_uri')).toBe(`${ADMIN_ORIGIN}/`);
    expect(rawSetCookies(res.headers).some((line) => line.startsWith(`${SESSION}=;`))).toBe(true);
    expect((await sessionInfo(session ?? '')).statusCode).toBe(401);
    const logout = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'identity.logout.succeeded' },
    });
    expect(logout).not.toBeNull();
  });

  it('lists sessions, lets users end their own and admins end anyone’s', async () => {
    const a = await login();
    const b = await login();
    const cookie = cookieHeader({ [SESSION]: a.session ?? '' });
    const mine = await app.inject({
      remoteAddress: browserIp,
      method: 'GET',
      url: '/v1/me/sessions',
      headers: { cookie },
    });
    const data = mine.json<{ data: { id: string; current: boolean }[] }>().data;
    expect(data.filter((s) => s.current)).toHaveLength(1);
    const otherId = (await sessionInfo(b.session ?? '')).json<{ session: { id: string } }>().session
      .id;
    const csrf = (await sessionInfo(a.session ?? '')).json<{ csrfToken: string }>().csrfToken;
    const end = await app.inject({
      remoteAddress: browserIp,
      method: 'DELETE',
      url: `/v1/me/sessions/${otherId}`,
      headers: { cookie, origin: ADMIN_ORIGIN, 'x-csrf-token': csrf },
    });
    expect(end.statusCode).toBe(204);
    expect((await sessionInfo(b.session ?? '')).statusCode).toBe(401);

    const userId = (await sessionInfo(a.session ?? '')).json<{ user: { id: string } }>().user.id;
    const all = await app.inject({
      remoteAddress: browserIp,
      method: 'DELETE',
      url: `/v1/users/${userId}/sessions`,
      headers: await tenant.auth(),
    });
    expect(all.json<{ terminated: number }>().terminated).toBeGreaterThan(0);
    expect((await sessionInfo(a.session ?? '')).statusCode).toBe(401);
  });

  it('enforces the concurrent-session limit (deny policy) and disabling the IdP ends its sessions', async () => {
    const limited = uniqueSlug('limit');
    const limitedTenant = await createTenant(owner, kit, limited, {
      session: { maxConcurrentSessions: 1, onLimit: 'deny' },
    });
    const previous = { tenant, slug, idpId };
    tenant = limitedTenant;
    slug = limited;
    const created = await createIdp();
    idpId = created.id;
    idp.user = { sub: 'sub-limit', email: `limit@${limited}.test`, email_verified: true };
    const first = await login();
    expect(first.session).toBeDefined();
    const second = await login();
    expect(second.callback.headers.location).toBe(`${ADMIN_ORIGIN}/?authError=session_limit`);

    const etag = (
      await app.inject({
        remoteAddress: browserIp,
        method: 'GET',
        url: `/v1/identity-providers/${idpId}`,
        headers: await tenant.auth(),
      })
    ).headers.etag;
    const disable = await app.inject({
      remoteAddress: browserIp,
      method: 'PATCH',
      url: `/v1/identity-providers/${idpId}`,
      headers: { ...(await tenant.auth()), 'if-match': String(etag) },
      payload: { status: 'disabled' },
    });
    expect(disable.statusCode, disable.body).toBe(200);
    expect((await sessionInfo(first.session ?? '')).statusCode).toBe(401);
    ({ tenant, slug, idpId } = previous);
  });
});

it('scopes an SSO-only agent assignment without a manual duplicate, preserves it on re-login and denies user enumeration', async () => {
  const before = idp.user;
  try {
    idp.user = { ...idp.user, groups: [] };
    const first = await login();
    const user = (await sessionInfo(first.session ?? '')).json<{ user: { id: string } }>().user;
    const campaign = await owner.campaign.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'SSO campaign scope',
        createdBy: 'fixture',
        updatedBy: 'fixture',
      },
    });
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/authz/users/${user.id}/role-scope`,
      headers: await tenant.auth(),
      payload: { role: 'agent', scope: { campaignIds: [campaign.id] } },
    });
    expect(response.statusCode, response.body).toBe(200);
    await login();
    const assignments = await owner.userRole.findMany({
      where: { tenantId: tenant.tenantId, userId: user.id, deletedAt: null },
      include: { role: true },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      source: `claims:${idpId}`,
      scope: { campaignIds: [campaign.id] },
      role: { name: 'agent' },
    });
    const headers = { cookie: cookieHeader({ [SESSION]: first.session ?? '' }) };
    for (const url of [
      '/v1/users',
      `/v1/users/${tenant.adminId}`,
      `/v1/users/${user.id}`,
      '/v1/groups',
    ])
      expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me/permissions', headers })).statusCode,
    ).toBe(200);
  } finally {
    idp.user = before;
  }
});
