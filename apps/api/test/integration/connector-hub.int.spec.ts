import { X509Certificate } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256Base64Url } from '../../src/modules/identity/crypto/random.js';
import { generateSpCredential } from '../../src/modules/identity/saml/sp-credentials.js';
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

/** connector-hub → API bridge (ADR-0018): mTLS-only, user mapping, synchronous interaction upsert. */
let owner: PrismaClient, app: NestFastifyApplication, kit: TokenKit;
let t: TenantFixture, other: TenantFixture;
let cert: string, thumbprint: string, connectorId: string;
let mappedUserId: string, emailUserId: string;

const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(
    integrationEnv(kit.jwks, {
      MTLS_PROXY_SECRET: 'integration-edge-secret-32-characters',
      MTLS_CLIENT_CERT_HEADER: 'x-client-cert',
    }),
  );
  t = await createTenant(owner, kit, uniqueSlug('hub'));
  other = await createTenant(owner, kit, uniqueSlug('hub-other'));
  const credential = await generateSpCredential('connector-hub');
  cert = credential.certificate;
  thumbprint = sha256Base64Url(new X509Certificate(cert).raw);
  connectorId = (
    await owner.connector.create({
      data: {
        tenantId: t.tenantId,
        adapterType: 'generic',
        platform: 'generic',
        status: 'active',
        config: { kind: 'webhook' },
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  ).id;
  const user = (email: string, cti: unknown[]) =>
    owner.user.create({
      data: {
        tenantId: t.tenantId,
        email,
        displayName: email,
        status: 'active',
        ctiIdentities: cti as object[],
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
  mappedUserId = (await user(`cti@${t.tenantId}.test`, [{ platform: 'generic', id: 'gw-agent-1' }]))
    .id;
  emailUserId = (await user(`mail-agent@${t.tenantId}.test`, [])).id;
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

async function hub(tenant = t, withCert = true) {
  const token = await kit.sign({
    sub: 'connector-hub',
    tnt: tenant.tenantId,
    typ: 'service',
    scp: ['read:Connector', 'update:Connector', 'create:Session'],
    ...(withCert ? { cnf: { 'x5t#S256': thumbprint } } : {}),
  });
  return {
    ...json,
    authorization: `Bearer ${token}`,
    ...(withCert
      ? {
          'x-verbis-mtls-proxy-secret': 'integration-edge-secret-32-characters',
          'x-client-cert': encodeURIComponent(cert),
        }
      : {}),
  };
}

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: `evt-${crypto.randomUUID()}`,
  type: 'connected',
  occurredAt: new Date(Date.now() - 1_000).toISOString(),
  platformInteractionId: `conv-${crypto.randomUUID()}`,
  channel: 'chat',
  direction: 'inbound',
  agent: { id: 'gw-agent-1' },
  attributes: { segment: 'gold' },
  context: {
    channel: 'chat',
    customerName: 'Ayşe',
    transcript: [{ from: 'customer', text: 'Merhaba', at: new Date().toISOString() }],
  },
  ...overrides,
});

const ingest = async (payload: unknown, headers?: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: `/v1/connector-hub/connectors/${connectorId}/events`,
    headers: headers ?? (await hub()),
    payload: { event: payload },
  });

describe('connector-hub bridge', () => {
  it('lists active connectors for the mTLS hub only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connector-hub/connectors',
      headers: await hub(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }[]>().map((c) => c.id)).toEqual([connectorId]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/connector-hub/connectors',
          headers: await hub(t, false),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/connector-hub/connectors',
          headers: { ...json, ...(await t.auth()) },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('upserts the interaction synchronously, maps the agent and keeps channel context for scripts', async () => {
    const e = event();
    const res = await ingest(e);
    expect(res.statusCode, res.body).toBe(201);
    const { interactionId, agentId } = res.json<{ interactionId: string; agentId: string }>();
    expect(agentId).toBe(mappedUserId);
    const row = await owner.interaction.findUniqueOrThrow({ where: { id: interactionId } });
    expect(row).toMatchObject({
      status: 'connected',
      agentId: mappedUserId,
      channelType: 'chat',
      externalId: e.platformInteractionId,
      connectorId,
    });
    // PII-bearing attributes are sealed at rest.
    expect(JSON.stringify(row.attributes)).not.toContain('Ayşe');
    const audit = await owner.auditEvent.findFirst({
      where: { tenantId: t.tenantId, action: 'connector.event.received', targetId: interactionId },
    });
    expect(audit?.metadata).toMatchObject({ eventId: e.eventId, agentMapped: true });

    const ended = await ingest({
      ...e,
      eventId: `${e.eventId}-end`,
      type: 'ended',
      occurredAt: new Date().toISOString(),
    });
    expect(ended.json<{ interactionId: string }>().interactionId).toBe(interactionId);
    expect(
      (await owner.interaction.findUniqueOrThrow({ where: { id: interactionId } })).status,
    ).toBe('ended');
  });

  it('maps by email when no CTI identity matches; unknown users map to nobody', async () => {
    expect(
      (
        await ingest(
          event({ agent: { id: 'unknown-platform-id', email: `MAIL-AGENT@${t.tenantId}.test` } }),
        )
      ).json(),
    ).toMatchObject({ agentId: emailUserId });
    expect((await ingest(event({ agent: { id: 'nobody' } }))).json()).toMatchObject({
      agentId: null,
    });
  });

  it('a connected event followed by a launch intent opens a session path for the mapped agent', async () => {
    const { interactionId } = (
      await ingest(event({ channel: 'voice', context: { channel: 'voice', ani: '+905550000001' } }))
    ).json<{ interactionId: string }>();
    const launch = await app.inject({
      method: 'POST',
      url: '/v1/launch-intents',
      headers: await hub(),
      payload: { connectorId, interactionId, userId: mappedUserId, delivery: 'fragment' },
    });
    expect(launch.statusCode, launch.body).toBe(201);
  });

  it('rejects invalid events, foreign tenants and bearer-only callers', async () => {
    expect((await ingest({ ...event(), channel: 'fax' })).statusCode).toBe(400);
    expect((await ingest({ ...event(), context: { channel: 'voice' } })).statusCode).toBe(400);
    const foreign = await app.inject({
      method: 'POST',
      url: `/v1/connector-hub/connectors/${connectorId}/events`,
      headers: await hub(other),
      payload: { event: event() },
    });
    expect(foreign.statusCode).toBe(404);
    expect((await ingest(event(), await hub(t, false))).statusCode).toBe(403);
  });

  it('normalizes admin platform names across real JSON queries and rejects duplicate identities', async () => {
    const connector = await owner.connector.create({
      data: {
        tenantId: t.tenantId,
        adapterType: 'genesys_cloud',
        platform: 'genesys',
        status: 'active',
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
    const mapping = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${mappedUserId}/connector-mapping`,
      headers: await t.auth(),
      payload: { platform: ' GENESYS CLOUD ', platformUserId: 'normalized-agent' },
    });
    expect(mapping.statusCode, mapping.body).toBe(200);
    const row = await owner.user.findUniqueOrThrow({ where: { id: mappedUserId } });
    expect(row.ctiIdentities).toEqual([
      { platform: 'generic', id: 'gw-agent-1' },
      { platform: 'genesys-cloud', id: 'normalized-agent' },
    ]);
    const received = await app.inject({
      method: 'POST',
      url: `/v1/connector-hub/connectors/${connector.id}/events`,
      headers: await hub(),
      payload: { event: event({ agent: { id: 'normalized-agent' } }) },
    });
    expect(received.statusCode, received.body).toBe(201);
    expect(received.json<{ agentId: string }>().agentId).toBe(mappedUserId);
    const duplicate = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${emailUserId}/connector-mapping`,
      headers: await t.auth(),
      payload: { platform: 'genesys_cloud', platformUserId: 'normalized-agent' },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
  });
  it('records health changes once per transition', async () => {
    const report = async (status: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/connector-hub/connectors/${connectorId}/health`,
        headers: await hub(),
        payload: { status },
      });
    for (const status of ['up', 'up', 'down']) expect((await report(status)).statusCode).toBe(204);
    const changes = await owner.auditEvent.count({
      where: { tenantId: t.tenantId, action: 'connector.health.changed', targetId: connectorId },
    });
    expect(changes).toBe(2);
  });
});
