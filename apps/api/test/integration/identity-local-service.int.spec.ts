import { Redis } from 'ioredis';
import { exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { Keyring } from '../../src/modules/identity/crypto/keyring.js';
import { totp } from '../../src/modules/identity/crypto/totp.js';
import { generateSpCredential } from '../../src/modules/identity/saml/sp-credentials.js';
import {
  ConcurrentSessionLimitError,
  SessionStore,
} from '../../src/modules/identity/session/session-store.js';
import { cookieHeader, setCookies } from '../support/http.js';
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

const ADMIN_ORIGIN = 'http://localhost:5175';
const SESSION = '__Host-verbis_session';
const PASSWORD = 'quiet-river-lamp-stone-harbor-77';

let app: NestFastifyApplication;
let owner: PrismaClient;
let kit: TokenKit;
let tenant: TenantFixture;
let slug: string;

beforeAll(async () => {
  owner = ownerPrisma();
  // A signing key published in the JWKS lets the API verify the tokens it issues.
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  kit = await createTokenKit();
  const issuerPublic = { ...(await exportJWK(publicKey)), kid: 'issuer-1', alg: 'EdDSA' };
  const jwks = JSON.stringify({
    keys: [...(JSON.parse(kit.jwks) as { keys: unknown[] }).keys, issuerPublic],
  });
  app = await startApp(
    integrationEnv(jwks, {
      INTERNAL_JWT_SIGNING_JWK: JSON.stringify({
        ...(await exportJWK(privateKey)),
        kid: 'issuer-1',
        alg: 'EdDSA',
      }),
      MTLS_CLIENT_CERT_HEADER: 'x-client-cert',
      BREAK_GLASS_MAX_ATTEMPTS: '3',
    }),
  );
  slug = uniqueSlug('local');
  tenant = await createTenant(owner, kit, slug);
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

describe('break-glass local administrator', () => {
  let secret: string;
  const login = (code: string, options: { origin?: string; password?: string } = {}) =>
    app.inject({
      method: 'POST',
      url: '/auth/break-glass/login',
      headers: { origin: options.origin ?? ADMIN_ORIGIN },
      payload: {
        tenant: slug,
        email: `admin@${slug}.test`,
        password: options.password ?? PASSWORD,
        code,
      },
    });

  it('enrolls with argon2id + TOTP and requires MFA confirmation', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/v1/break-glass-accounts',
      headers: await tenant.auth(),
      payload: { userId: tenant.adminId, password: 'short' },
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.json()).toMatchObject({ code: 'VERBIS_IDENTITY_PASSWORD_WEAK' });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/v1/break-glass-accounts',
      headers: await tenant.auth(),
      payload: { userId: tenant.adminId, password: PASSWORD },
    });
    expect(enrolled.statusCode, enrolled.body).toBe(201);
    ({ totpSecret: secret } = enrolled.json<{ totpSecret: string; totpUri: string }>());
    const stored = await owner.localCredential.findUniqueOrThrow({
      where: { userId: tenant.adminId },
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.totpSecret).not.toContain(secret);
    expect((await login(totp(secret, Date.now()))).statusCode).toBe(401); // pending MFA

    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/break-glass-accounts/${tenant.adminId}/activate`,
      headers: await tenant.auth(),
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(422);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/break-glass-accounts/${tenant.adminId}/activate`,
      headers: await tenant.auth(),
      payload: { code: totp(secret, Date.now()) },
    });
    expect(ok.json()).toMatchObject({ status: 'active' });
  });

  it('is accepted only from the admin-web origin and every attempt is a critical audit event', async () => {
    const elsewhere = await login(totp(secret, Date.now() + 30_000), {
      origin: 'http://localhost:5174',
    });
    expect(elsewhere.statusCode).toBe(403);
    expect(elsewhere.json()).toMatchObject({ code: 'VERBIS_AUTH_ORIGIN_NOT_ALLOWED' });

    const res = await login(totp(secret, Date.now() + 30_000));
    expect(res.statusCode, res.body).toBe(200);
    const session = setCookies(res.headers)[SESSION] ?? '';
    // A replayed TOTP code (same step) is refused.
    expect((await login(totp(secret, Date.now() + 30_000))).statusCode).toBe(401);

    const cookie = cookieHeader({ [SESSION]: session });
    const info = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie, origin: ADMIN_ORIGIN },
    });
    expect(info.json()).toMatchObject({
      user: { authMethod: 'break_glass' },
      session: { protocol: 'local' },
    });
    // The session is bound to the admin-web origin.
    const fromAgent = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie, origin: 'http://localhost:5174' },
    });
    expect(fromAgent.statusCode).toBe(401);

    const used = await owner.auditEvent.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, action: 'identity.breakGlass.used' },
    });
    expect(used.diff).toMatchObject({ after: { severity: 'critical' } });
    const failed = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId, action: 'identity.breakGlass.failed' },
    });
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(
      await owner.outboxEvent.count({
        where: { tenantId: tenant.tenantId, eventType: 'verbis.identity.breakGlass.used.v1' },
      }),
    ).toBe(1);
  });

  it('locks the account after repeated failures, and unknown accounts fail the same way', async () => {
    for (let i = 0; i < 3; i += 1)
      expect(
        (await login('123456', { password: 'wrong-password-wrong-password' })).statusCode,
      ).toBe(401);
    const locked = await owner.localCredential.findUniqueOrThrow({
      where: { userId: tenant.adminId },
    });
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect((await login(totp(secret, Date.now() + 60_000))).statusCode).toBe(401);
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/break-glass/login',
      headers: { origin: ADMIN_ORIGIN },
      payload: { tenant: slug, email: 'nobody@nowhere.test', password: PASSWORD, code: '123456' },
    });
    expect(unknown.json()).toMatchObject({ code: 'VERBIS_AUTH_INVALID_CREDENTIALS' });
  });
});

describe('service clients (OAuth 2.0 client credentials, mTLS)', () => {
  const token = (body: Record<string, string>, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/oauth2/${slug}/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      payload: new URLSearchParams(body).toString(),
    });

  it('issues a short-lived internal token usable on the API, with audit', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/service-clients',
      headers: await tenant.auth(),
      payload: { name: 'genesys-connector', scopes: ['read:Session', 'read:Campaign'] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { clientId, clientSecret } = created.json<{ clientId: string; clientSecret: string }>();
    expect(
      (await owner.serviceClient.findUniqueOrThrow({ where: { id: clientId } })).secretHash,
    ).not.toContain(clientSecret);

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await token(
      { grant_type: 'client_credentials', scope: 'read:Campaign' },
      { authorization: `Basic ${basic}` },
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']?.split(',').map((directive) => directive.trim())).toContain(
      'no-store',
    );
    const body = res.json<{ access_token: string; expires_in: number; scope: string }>();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 300, scope: 'read:Campaign' });
    const me = await app.inject({
      method: 'GET',
      url: '/v1/authz/me',
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect(me.json()).toMatchObject({
      principal: { type: 'service', id: `svc:${clientId}` },
      permissions: ['read:Campaign'],
    });
    const forbidden = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      await owner.auditEvent.findFirst({
        where: { tenantId: tenant.tenantId, action: 'identity.serviceToken.issued' },
      }),
    ).not.toBeNull();

    // Wrong method, wrong secret, scope escalation, unsupported grant.
    expect(
      (
        await token({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        })
      ).json(),
    ).toEqual({ error: 'invalid_client' });
    const wrongSecret = await token(
      { grant_type: 'client_credentials' },
      {
        authorization: `Basic ${Buffer.from(`${clientId}:vsc_${'x'.repeat(43)}`).toString('base64')}`,
      },
    );
    expect(wrongSecret.statusCode).toBe(401);
    expect(wrongSecret.headers['www-authenticate']).toContain('Basic');
    expect(
      (
        await token(
          { grant_type: 'client_credentials', scope: 'manage:all' },
          { authorization: `Basic ${basic}` },
        )
      ).json(),
    ).toEqual({ error: 'invalid_scope' });
    expect(
      (await token({ grant_type: 'password' }, { authorization: `Basic ${basic}` })).json(),
    ).toEqual({ error: 'unsupported_grant_type' });
    const rejected = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId, action: 'identity.serviceToken.rejected' },
    });
    expect(rejected.length).toBeGreaterThanOrEqual(3);
  });

  it('tls_client_auth binds the token to the client certificate (RFC 8705)', async () => {
    const cert = await generateSpCredential('connector-hub');
    const other = await generateSpCredential('someone-else');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/service-clients',
      headers: await tenant.auth(),
      payload: {
        name: 'mtls-connector',
        authMethod: 'tls_client_auth',
        scopes: ['read:Session'],
        certificate: cert.certificate,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { clientId, clientSecret } = created.json<{
      clientId: string;
      clientSecret: string | null;
    }>();
    expect(clientSecret).toBeNull();
    const header = (pem: string) => ({ 'x-client-cert': encodeURIComponent(pem) });

    expect(
      (
        await token(
          { grant_type: 'client_credentials', client_id: clientId },
          header(other.certificate),
        )
      ).statusCode,
    ).toBe(401);
    const res = await token(
      { grant_type: 'client_credentials', client_id: clientId },
      header(cert.certificate),
    );
    expect(res.statusCode, res.body).toBe(200);
    const access = res.json<{ access_token: string }>().access_token;
    const withCert = await app.inject({
      method: 'GET',
      url: '/v1/authz/me',
      headers: { authorization: `Bearer ${access}`, ...header(cert.certificate) },
    });
    expect(withCert.statusCode).toBe(200);
    const stolen = await app.inject({
      method: 'GET',
      url: '/v1/authz/me',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(stolen.statusCode).toBe(401);
  });

  it('admins cannot delegate permissions they do not hold', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/service-clients',
      headers: await tenant.auth(tenant.designerId),
      payload: { name: 'escalate', scopes: ['manage:all'] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('SessionStore (Redis)', () => {
  let redis: Redis;
  let now = 1_800_000_000_000;
  let store: SessionStore;
  const TENANT = '01928f3a-0000-7000-8000-0000000000aa';
  const USER = '01928f3a-0000-7000-8000-0000000000bb';
  const IDP = '01928f3a-0000-7000-8000-0000000000cc';
  const policy = {
    idleTimeoutSeconds: 600,
    absoluteTimeoutSeconds: 3600,
    maxConcurrent: 2,
    onLimit: 'evict_oldest' as const,
  };
  const input = (sid: string) => ({
    tenantId: TENANT,
    userId: USER,
    kind: 'sso' as const,
    protocol: 'oidc' as const,
    idpId: IDP,
    app: 'admin',
    ip: '127.0.0.1',
    userAgent: 'test',
    oidc: { sub: 'sub-1', sid, refreshToken: 'secret-refresh-token' },
  });

  beforeAll(() => {
    redis = new Redis(inject('redisUrl'), { keyPrefix: 'verbis:test:' });
    store = new SessionStore(
      redis,
      new Keyring(`k1:${Buffer.alloc(32, 3).toString('base64')}`),
      () => now,
    );
  });
  afterAll(() => {
    redis.disconnect();
  });

  it('seals records (no tokens in Redis) and enforces idle and absolute timeouts', async () => {
    const created = await store.create(input('sid-a'), policy);
    const raw = await redis.get(`idn:sess:${SessionStore.hashToken(created.token)}`);
    expect(raw).not.toContain('secret-refresh-token');
    expect(raw).not.toContain(created.token);
    expect((await store.load(created.token))?.record.id).toBe(created.record.id);
    now += 599_000;
    expect(await store.load(created.token)).toBeDefined(); // touched: idle timer restarts
    now += 599_000;
    expect(await store.load(created.token)).toBeDefined();
    now += 601_000;
    expect(await store.load(created.token)).toBeUndefined(); // idle

    const second = await store.create(input('sid-b'), { ...policy, idleTimeoutSeconds: 3000 });
    for (let i = 0; i < 2; i += 1) {
      now += 1_500_000;
      await store.load(second.token);
    }
    now += 700_000;
    expect(await store.load(second.token)).toBeUndefined(); // absolute
    expect(await store.load('not-a-token')).toBeUndefined();
  });

  it('applies the concurrent-session limit and revokes by IdP session, subject and IdP', async () => {
    const a = await store.create(input('sid-1'), policy);
    now += 1000;
    const b = await store.create(input('sid-2'), policy);
    now += 1000;
    const c = await store.create(input('sid-3'), policy);
    expect(c.evicted.map((r) => r.id)).toEqual([a.record.id]);
    await expect(
      store.create(input('sid-4'), { ...policy, onLimit: 'deny' }),
    ).rejects.toBeInstanceOf(ConcurrentSessionLimitError);

    expect((await store.revokeByOidcSid(TENANT, IDP, 'sid-2')).map((r) => r.id)).toEqual([
      b.record.id,
    ]);
    expect(await store.load(b.token)).toBeUndefined();
    expect(
      (await store.revokeByOidcSid('01928f3a-0000-7000-8000-0000000000dd', IDP, 'sid-3')).length,
    ).toBe(0);
    expect((await store.revokeByIdp(TENANT, IDP)).map((r) => r.id)).toEqual([c.record.id]);
    expect(await store.listForUser(TENANT, USER)).toEqual([]);
  });

  it('allows one refresh lock holder at a time', async () => {
    const release = await store.tryLock('refresh:x');
    expect(release).toBeDefined();
    expect(await store.tryLock('refresh:x')).toBeUndefined();
    await release?.();
    expect(await store.tryLock('refresh:x')).toBeDefined();
  });
});
