import { X509Certificate } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ScriptDocumentSchema, TestScenarioSchema } from '@verbis/script-schema';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { RedisService } from '../../src/infra/redis/redis.service.js';
import { sha256Base64Url } from '../../src/modules/identity/crypto/random.js';
import { generateSpCredential } from '../../src/modules/identity/saml/sp-credentials.js';
import { launchAudience } from '../../src/modules/launch/domain/launch-jws.js';
import { launchCodeHash, newLaunchCode } from '../../src/modules/launch/domain/launch.js';
import { LaunchPorts } from '../../src/modules/launch/launch-ports.js';
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

/**
 * Secure launch (SECURITY §4): every forged, replayed, foreign, expired, cross-tenant or tampered
 * launch is refused with one generic problem, and every attempt is audited.
 */
let owner: PrismaClient, app: NestFastifyApplication, kit: TokenKit;
let a: TenantFixture, b: TenantFixture;
let agentId: string, otherAgentId: string;
let connectorId: string, campaignId: string;
let cert: string, thumbprint: string;
let platformSaysYes = true;
let issuerKey: CryptoKey;

let browserNumber = 0;
let browserIp = '203.0.113.1';
beforeEach(() => {
  browserIp = `203.0.113.${++browserNumber}`;
});
const json = { 'content-type': 'application/json' };
const sid = () => crypto.randomUUID();

beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(integrationEnv(kit.jwks, { MTLS_CLIENT_CERT_HEADER: 'x-client-cert' }));
  a = await createTenant(owner, kit, uniqueSlug('launch-a'), {
    embedding: { frameAncestors: ['https://apps.mypurecloud.de', 'https://*.crm.example.com'] },
  });
  b = await createTenant(owner, kit, uniqueSlug('launch-b'));
  agentId = await agentUser(a, 'agent-one');
  otherAgentId = await agentUser(a, 'agent-two');

  const credential = await generateSpCredential('connector-hub');
  cert = credential.certificate;
  thumbprint = sha256Base64Url(new X509Certificate(cert).raw);

  connectorId = (
    await owner.connector.create({
      data: {
        tenantId: a.tenantId,
        adapterType: 'genesys_cloud',
        platform: 'genesys',
        status: 'active',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  ).id;
  app.get(LaunchPorts).registerVerifier(connectorId, {
    isActiveParticipant: () => Promise.resolve(platformSaysYes),
  });

  await owner.dataSource.create({
    data: {
      tenantId: a.tenantId,
      key: 'survey-submit',
      protocol: 'rest',
      version: 1,
      definition: {
        baseUrl: 'https://example.test',
        endpoint: '/survey',
        auth: { type: 'none' },
        profiles: { prod: { baseUrl: 'https://example.test', auth: { type: 'none' } } },
      },
      secretRefs: [],
      createdBy: 'fixture-approved',
      updatedBy: 'fixture-approved',
    },
  });
  const document = ScriptDocumentSchema.parse(surveyScript);
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'surveyEnd',
      name: 'Synthetic promoter survey',
      synthetic: true,
      context: {},
      dataSources: { submitSurvey: { kind: 'success', outputs: { responseId: 'synthetic-id' } } },
      steps: [
        { type: 'event', node: 'btn-intro-start', event: 'onPress' },
        { type: 'variable', variable: 'npsScore', value: 10 },
        { type: 'event', node: 'btn-nps-next', event: 'onPress' },
        { type: 'variable', variable: 'reasons', value: ['speed'] },
        { type: 'event', node: 'btn-reasons-high-next', event: 'onPress' },
        { type: 'event', node: 'btn-submit', event: 'onPress' },
        { type: 'event', node: 'btn-thanks', event: 'onPress' },
      ],
      expected: { ended: true, variables: { npsSegment: 'promoter' } },
    }),
  ];
  // Published script assigned to an active campaign (admin authors, designer approves/publishes).
  const admin = { ...json, ...(await a.auth()) };
  const designer = { ...json, ...(await a.auth(a.designerId)) };
  const script = (
    await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/scripts',
      headers: admin,
      payload: { name: 'Launch' },
    })
  ).json<{ id: string }>();
  const version = (
    await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: `/v1/scripts/${script.id}/versions`,
      headers: admin,
      payload: { document, screens: [] },
    })
  ).json<{ id: string }>();
  await app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions/1/submit`,
    headers: admin,
    payload: { semver: '1.0.0', changeNote: 'release' },
  });
  await app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions/1/reviews`,
    headers: designer,
    payload: { decision: 'approved' },
  });
  const published = await app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions/1/publish`,
    headers: designer,
    payload: {},
  });
  expect(published.statusCode, published.body).toBe(200);
  campaignId = (
    await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/campaigns',
      headers: admin,
      payload: { name: 'Launch campaign', status: 'active', channels: ['voice'] },
    })
  ).json<{ id: string }>().id;
  const assignment = await app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: '/v1/assignments',
    headers: admin,
    payload: {
      scriptId: script.id,
      campaignId,
      versionPolicy: 'pinned',
      pinnedVersionId: version.id,
    },
  });
  expect(assignment.statusCode, assignment.body).toBe(201);

  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  issuerKey = privateKey;
  await owner.launchTrustedIssuer.create({
    data: {
      tenantId: a.tenantId,
      issuer: 'legacy-crm',
      jwks: { keys: [{ ...(await exportJWK(publicKey)), kid: 'crm-2026', alg: 'EdDSA' }] },
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

beforeEach(async () => {
  platformSaysYes = true;
  const redis = app.get(RedisService).client;
  const keys = await redis.keys('verbis:api:launch:fail:*');
  for (const key of keys) await redis.del(key.replace(/^verbis:api:/, ''));
});

async function agentUser(tenant: TenantFixture, name: string): Promise<string> {
  const role = await owner.role.findFirstOrThrow({
    where: { tenantId: tenant.tenantId, name: 'agent' },
  });
  const user = await owner.user.create({
    data: {
      tenantId: tenant.tenantId,
      email: `${name}@${tenant.tenantId}.test`,
      displayName: name,
      status: 'active',
      ctiIdentities: [{ platform: 'genesys', id: `g-${name}` }],
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  await owner.userRole.create({
    data: {
      tenantId: tenant.tenantId,
      userId: user.id,
      roleId: role.id,
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  return user.id;
}

async function interaction(userId = agentId, status = 'connected') {
  return await owner.interaction.create({
    data: {
      tenantId: a.tenantId,
      externalId: `conv-${crypto.randomUUID()}`,
      channelType: 'voice',
      connectorId,
      direction: 'inbound',
      campaignId,
      platform: 'genesys',
      status,
      agentId: userId,
      startedAt: new Date(),
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
}

async function userHeaders(userId: string, tenant: TenantFixture = a, session = sid()) {
  return {
    ...json,
    authorization: `Bearer ${await kit.sign({ sub: userId, tnt: tenant.tenantId, sid: session })}`,
  };
}

async function serviceHeaders(withCert = true, tenant: TenantFixture = a) {
  const token = await kit.sign({
    sub: 'connector-hub',
    tnt: tenant.tenantId,
    typ: 'service',
    scp: ['create:Session'],
    ...(withCert ? { cnf: { 'x5t#S256': thumbprint } } : {}),
  });
  return {
    ...json,
    authorization: `Bearer ${token}`,
    ...(withCert ? { 'x-client-cert': encodeURIComponent(cert) } : {}),
  };
}

async function createIntent(userId: string, interactionId: string, delivery = 'fragment') {
  const res = await app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: '/v1/launch-intents',
    headers: await serviceHeaders(),
    payload: { connectorId, interactionId, userId, delivery },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ intentId: string; code: string; expiresAt: string }>();
}

async function redeem(code: string, headers: Record<string, string>) {
  return app.inject({
    remoteAddress: browserIp,
    method: 'POST',
    url: '/v1/launch/redeem',
    headers,
    payload: { code },
  });
}

async function denials(tenantId = a.tenantId) {
  return owner.auditEvent.findMany({
    where: { tenantId, action: 'launch.attempt.denied' },
    orderBy: { seq: 'asc' },
    select: { reason: true, outcome: true, targetId: true },
  });
}

function expectDenied(res: { statusCode: number; json: () => unknown }) {
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: 'VERBIS_LAUNCH_DENIED', status: 403 });
}

describe('server-to-server launch (connector-hub → intent → agent redeem)', () => {
  it('creates a ≤60 s single-use intent, stores only the code hash, and redeems into a bound session', async () => {
    const i = await interaction();
    const intent = await createIntent(agentId, i.id);
    expect(intent.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(intent.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
    const row = await owner.launchIntent.findUniqueOrThrow({ where: { id: intent.intentId } });
    expect(row.codeHash).toBe(launchCodeHash(intent.code));
    expect(JSON.stringify(row)).not.toContain(intent.code);

    const res = await redeem(intent.code, await userHeaders(agentId));
    expect(res.statusCode, res.body).toBe(201);
    const { sessionId, path } = res.json<{ sessionId: string; path: string }>();
    expect(path).toBe(`/s/${sessionId}`);
    const session = await owner.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session).toMatchObject({ userId: agentId, interactionId: i.id, kind: 'interaction' });
    expect(
      await owner.launchIntent.findUniqueOrThrow({ where: { id: intent.intentId } }),
    ).toMatchObject({
      state: 'redeemed',
      sessionId,
    });
    const audited = await owner.auditEvent.findMany({
      where: { tenantId: a.tenantId, targetId: intent.intentId },
      orderBy: { seq: 'asc' },
      select: { action: true },
    });
    expect(audited.map((e) => e.action)).toEqual(['launch.intent.created', 'launch.code.redeemed']);
  });

  it('refuses a replayed code', async () => {
    const i = await interaction();
    const { code } = await createIntent(agentId, i.id);
    expect((await redeem(code, await userHeaders(agentId))).statusCode).toBe(201);
    expectDenied(await redeem(code, await userHeaders(agentId)));
    expect((await denials()).at(-1)).toMatchObject({ reason: 'code_replayed', outcome: 'denied' });
  });

  it("refuses another user's code", async () => {
    const i = await interaction();
    const { code, intentId } = await createIntent(agentId, i.id);
    expectDenied(await redeem(code, await userHeaders(otherAgentId)));
    expect((await denials()).at(-1)).toMatchObject({ reason: 'user_mismatch', targetId: intentId });
    // Still pending: the rightful agent can use it.
    expect((await redeem(code, await userHeaders(agentId))).statusCode).toBe(201);
  });

  it('refuses an expired code', async () => {
    const i = await interaction();
    const code = newLaunchCode();
    await owner.launchIntent.create({
      data: {
        tenantId: a.tenantId,
        userId: agentId,
        interactionId: i.id,
        connectorId,
        flow: 's2s',
        codeHash: launchCodeHash(code),
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 61_000),
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
    expectDenied(await redeem(code, await userHeaders(agentId)));
    expect((await denials()).at(-1)).toMatchObject({ reason: 'code_expired' });
  });

  it('refuses a code from another tenant (RLS makes it unknown)', async () => {
    const i = await interaction();
    const { code } = await createIntent(agentId, i.id);
    const bUser = await agentUser(b, 'b-agent');
    expectDenied(await redeem(code, await userHeaders(bUser, b)));
    expect((await denials(b.tenantId)).at(-1)).toMatchObject({ reason: 'code_unknown' });
  });

  it('refuses fabricated and malformed codes', async () => {
    expectDenied(await redeem(newLaunchCode(), await userHeaders(agentId)));
    expectDenied(await redeem('not-a-code', await userHeaders(agentId)));
    expect((await denials()).slice(-2).map((d) => d.reason)).toEqual([
      'code_unknown',
      'code_malformed',
    ]);
  });

  it('refuses a redeem without a bound BFF session', async () => {
    const i = await interaction();
    const { code } = await createIntent(agentId, i.id);
    const headers = {
      ...json,
      authorization: `Bearer ${await kit.sign({ sub: agentId, tnt: a.tenantId })}`,
    };
    expectDenied(await redeem(code, headers));
    expect((await denials()).at(-1)).toMatchObject({ reason: 'session_missing' });
  });

  it('refuses a code when the interaction ended before redemption, and re-verifies the platform', async () => {
    const ended = await interaction();
    const first = await createIntent(agentId, ended.id);
    await owner.interaction.update({
      where: { id: ended.id },
      data: { status: 'ended', endedAt: new Date() },
    });
    expectDenied(await redeem(first.code, await userHeaders(agentId)));

    const live = await interaction();
    const second = await createIntent(agentId, live.id);
    platformSaysYes = false;
    expectDenied(await redeem(second.code, await userHeaders(agentId)));
    expect((await denials()).slice(-2).map((d) => d.reason)).toEqual([
      'interaction_inactive',
      'platform_unverified',
    ]);
  });

  it('only a certificate-bound service client can create intents', async () => {
    const i = await interaction();
    const payload = { connectorId, interactionId: i.id, userId: agentId };
    const noCert = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch-intents',
      headers: await serviceHeaders(false),
      payload,
    });
    expectDenied(noCert);
    const asUser = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch-intents',
      headers: await userHeaders(agentId),
      payload,
    });
    expectDenied(asUser);
    // An interaction not assigned to the named user cannot be launched for them.
    const wrongUser = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch-intents',
      headers: await serviceHeaders(),
      payload: { ...payload, userId: otherAgentId },
    });
    expectDenied(wrongUser);
    const reasons = (await denials()).slice(-3).map((d) => d.reason);
    expect(reasons).toEqual(['mtls_required', 'not_service', 'interaction_not_assigned']);
  });
});

describe('URL parameters never open a script', () => {
  it('has no route that opens a session from query parameters', async () => {
    const i = await interaction();
    const query = `?scriptId=${crypto.randomUUID()}&campaignId=${campaignId}&userId=${agentId}&interactionId=${i.id}`;
    const headers = await userHeaders(agentId);
    for (const url of [`/v1/launch/redeem${query}`, `/v1/sessions${query}`, `/v1/launch${query}`]) {
      const res = await app.inject({
        remoteAddress: browserIp,
        method: 'POST',
        url,
        headers,
        payload: {},
      });
      expect([400, 404]).toContain(res.statusCode);
    }
    expect(await owner.session.count({ where: { interactionId: i.id } })).toBe(0);
  });

  it('records ignored identifying parameters as a security signal', async () => {
    const res = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch/param-signals',
      headers: await userHeaders(agentId),
      payload: { params: ['scriptId', 'campaignId', 'utm_source'] },
    });
    expect(res.statusCode).toBe(204);
    const event = await owner.auditEvent.findFirst({
      where: { tenantId: a.tenantId, action: 'launch.urlParams.rejected' },
      orderBy: { seq: 'desc' },
    });
    expect(event?.metadata).toMatchObject({ params: ['campaignid', 'scriptid'] });
  });
});

describe('embedded launch (platform hint verified with the platform API)', () => {
  it('opens only when the platform confirms the user is an active participant', async () => {
    const i = await interaction();
    const payload = { connectorId, conversationId: i.externalId };
    platformSaysYes = false;
    expectDenied(
      await app.inject({
        remoteAddress: browserIp,
        method: 'POST',
        url: '/v1/launch/embedded',
        headers: await userHeaders(agentId),
        payload,
      }),
    );
    platformSaysYes = true;
    // A hint naming someone else's conversation is refused even if the platform would say yes.
    expectDenied(
      await app.inject({
        remoteAddress: browserIp,
        method: 'POST',
        url: '/v1/launch/embedded',
        headers: await userHeaders(otherAgentId),
        payload,
      }),
    );
    const ok = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch/embedded',
      headers: await userHeaders(agentId),
      payload,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await denials()).slice(-2).map((d) => d.reason)).toEqual([
      'platform_unverified',
      'interaction_not_assigned',
    ]);
  });
});

describe('CTI-less launch (tenant-signed JWS)', () => {
  async function jws(
    claims: Record<string, unknown>,
    options: { lifetime?: number; iat?: number; kid?: string; aud?: string } = {},
  ) {
    const iat = options.iat ?? Math.floor(Date.now() / 1000);
    return new SignJWT({ agentId, ...claims })
      .setProtectedHeader({ alg: 'EdDSA', kid: options.kid ?? 'crm-2026' })
      .setIssuer('legacy-crm')
      .setAudience(options.aud ?? launchAudience(a.tenantId))
      .setIssuedAt(iat)
      .setExpirationTime(iat + (options.lifetime ?? 30))
      .setJti(`jti-${crypto.randomUUID()}`)
      .sign(issuerKey);
  }
  const post = async (token: string, userId = agentId) =>
    app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch/jws',
      headers: await userHeaders(userId),
      payload: { token },
    });

  it('accepts a valid token once and refuses its replay', async () => {
    const i = await interaction();
    const token = await jws({ interactionId: i.id });
    expect((await post(token)).statusCode).toBe(201);
    expectDenied(await post(token));
    expect((await denials()).at(-1)).toMatchObject({ reason: 'code_replayed' });
  });

  it('refuses tampered signatures, foreign audiences, long lifetimes, expired tokens and other agents', async () => {
    const i = await interaction();
    const valid = await jws({ interactionId: i.id });
    const [h, p, s] = valid.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(p, 'base64url').toString()),
        agentId: otherAgentId,
      }),
    ).toString('base64url');
    expectDenied(await post(`${h}.${forgedPayload}.${s}`, otherAgentId));
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'crm-2026' })).toString('base64url')}.${p}.`;
    expect([400, 403]).toContain((await post(unsigned)).statusCode);
    expectDenied(
      await post(await jws({ interactionId: i.id }, { aud: launchAudience(b.tenantId) })),
    );
    expectDenied(await post(await jws({ interactionId: i.id }, { lifetime: 600 })));
    expectDenied(
      await post(await jws({ interactionId: i.id }, { iat: Math.floor(Date.now() / 1000) - 300 })),
    );
    expectDenied(await post(await jws({ interactionId: i.id }, { kid: 'unknown-kid' })));
    expectDenied(await post(await jws({ interactionId: i.id }), otherAgentId));
    expect((await denials()).slice(-6).map((d) => d.reason)).toEqual([
      'token_signature',
      'token_audience',
      'token_lifetime',
      'code_expired',
      'token_signature',
      'user_mismatch',
    ]);
  });
});

describe('rate limit and anomaly detection', () => {
  it('raises an anomaly after repeated failures and then blocks further attempts', async () => {
    const anomalyUser = await agentUser(a, 'anomaly-agent');
    const headers = await userHeaders(anomalyUser);
    for (let n = 0; n < 10; n += 1) expectDenied(await redeem(newLaunchCode(), headers));
    const blocked = await redeem(newLaunchCode(), headers);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'VERBIS_LAUNCH_RATE_LIMITED' });
    const anomaly = await owner.auditEvent.findFirst({
      where: { tenantId: a.tenantId, action: 'launch.anomaly.detected', actorId: anomalyUser },
    });
    expect(anomaly?.metadata).toMatchObject({ alert: true, failures: 5 });
    expect((await denials()).at(-1)).toMatchObject({ reason: 'rate_limited' });
  });
});

describe('designer preview', () => {
  it('needs designer permission, never attaches an interaction, and uses mock data by default', async () => {
    const version = await owner.scriptVersion.findFirstOrThrow({ where: { tenantId: a.tenantId } });
    const asAgent = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch/preview',
      headers: await userHeaders(agentId),
      payload: { scriptVersionId: version.id },
    });
    expect(asAgent.statusCode).toBe(403);
    const asDesigner = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch/preview',
      headers: await userHeaders(a.designerId),
      payload: { scriptVersionId: version.id },
    });
    expect(asDesigner.statusCode, asDesigner.body).toBe(201);
    const session = await owner.session.findUniqueOrThrow({
      where: { id: asDesigner.json<{ sessionId: string }>().sessionId },
    });
    expect(session).toMatchObject({ kind: 'preview', interactionId: null });
    expect(session.decisionTrace).toMatchObject({ preview: true, liveDataSources: false });
    const live = await app.inject({
      remoteAddress: browserIp,
      method: 'POST',
      url: '/v1/launch/preview',
      headers: await userHeaders(a.designerId),
      payload: { scriptVersionId: version.id, liveDataSources: true },
    });
    expect(live.statusCode).toBe(403);
  });
});

describe('framing', () => {
  it('API responses are never frameable; agent-web gets the tenant allow-list only', async () => {
    const res = await app.inject({ remoteAddress: browserIp, method: 'GET', url: '/health/live' });
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    const slugA = (await owner.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).slug;
    const slugB = (await owner.tenant.findUniqueOrThrow({ where: { id: b.tenantId } })).slug;
    expect(
      (
        await app.inject({
          remoteAddress: browserIp,
          method: 'GET',
          url: `/v1/embedding-policy/${slugA}`,
        })
      ).json(),
    ).toEqual({
      'content-security-policy':
        'frame-ancestors https://*.crm.example.com https://apps.mypurecloud.de',
    });
    expect(
      (
        await app.inject({
          remoteAddress: browserIp,
          method: 'GET',
          url: `/v1/embedding-policy/${slugB}`,
        })
      ).json(),
    ).toEqual({
      'content-security-policy': "frame-ancestors 'none'",
      'x-frame-options': 'DENY',
    });
    expect(
      (
        await app.inject({
          remoteAddress: browserIp,
          method: 'GET',
          url: '/v1/embedding-policy/no-such-tenant',
        })
      ).json(),
    ).toMatchObject({
      'x-frame-options': 'DENY',
    });
  });
});
