import { jetstreamManager, type JetStreamManager } from '@nats-io/jetstream';
import { connect, headers as natsHeaders, type NatsConnection } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { PrismaService } from '../../src/infra/database/prisma.service.js';
import { NatsService } from '../../src/infra/nats/nats.service.js';
import { OutboxRelayService, SqlOutboxStore } from '../../src/infra/outbox/outbox-relay.service.js';
import { OutboxRelay } from '../../src/infra/outbox/outbox.relay.js';
import { EventEnvelopeSchema } from '../../src/infra/outbox/outbox.types.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  type TenantFixture,
  uniqueSlug,
} from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let kit: TokenKit;
let owner: PrismaClient;
let app: NestFastifyApplication;
let nc: NatsConnection;
let jsm: JetStreamManager;

const json = { 'content-type': 'application/json' };
const decoder = new TextDecoder();

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (!accept(value)) {
    if (Date.now() > deadline)
      throw new Error(`condition not met in ${String(timeoutMs)}ms: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await fn();
  }
  return value;
}

/** Drains the outbox completely (all tenants) with the application relay. */
async function drain(): Promise<void> {
  const relay = app.get(OutboxRelayService);
  for (let i = 0; i < 50; i += 1) {
    if ((await relay.runOnce()).claimed !== 0) continue;
    // PostgreSQL and the application can differ by milliseconds. An empty claim does
    // not prove that newly committed application timestamps are already due in SQL.
    const now = new Date();
    const due = await owner.outboxEvent.count({
      where: {
        status: 'pending',
        availableAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
    });
    if (due === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Outbox did not drain after 50 relay passes');
}

async function createCampaign(tenant: TenantFixture, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/campaigns',
    headers: { ...json, ...(await tenant.auth()) },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(integrationEnv(kit.jwks));
  nc = await connect({ servers: inject('natsUrl') });
  jsm = await jetstreamManager(nc);
  await app.get(NatsService).ensureStreams();
});

afterAll(async () => {
  await app.close();
  await nc.drain();
  await owner.$disconnect();
});

describe('outbox → NATS JetStream', () => {
  it('publishes committed events with the event id as Nats-Msg-Id', async () => {
    await drain(); // other suites may have left events pending
    const tenant = await createTenant(owner, kit, uniqueSlug('relay'));
    const campaignId = await createCampaign(tenant, 'Relayed');
    const row = await owner.outboxEvent.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, eventType: 'verbis.campaigns.campaign.created.v1' },
    });
    expect(row.status).toBe('pending');

    await drain();

    const published = await owner.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(published).toMatchObject({ status: 'published', attempts: 1, lockedUntil: null });
    const message = await jsm.streams.getMessage('DOMAIN', {
      last_by_subj: 'verbis.campaigns.campaign.created.v1',
    });
    expect(message?.header.get('Nats-Msg-Id')).toBe(row.id);
    expect(message?.header.get('verbis-tenant-id')).toBe(tenant.tenantId);
    const envelope = EventEnvelopeSchema.parse(JSON.parse(decoder.decode(message?.data)));
    expect(envelope).toMatchObject({
      id: row.id,
      tenantId: tenant.tenantId,
      aggregate: { type: 'Campaign', id: campaignId },
      actor: `user:${tenant.adminId}`,
    });

    // Audit events go to their own stream.
    const audit = await jsm.streams.getMessage('AUDIT', {
      last_by_subj: 'verbis.audit.event.recorded.v1',
    });
    expect(audit).not.toBeNull();
  });

  it('a republish after a crash (row still pending) is deduplicated by JetStream', async () => {
    await drain();
    const tenant = await createTenant(owner, kit, uniqueSlug('dedupe'));
    await createCampaign(tenant, 'Dedupe');
    await drain();
    const row = await owner.outboxEvent.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, eventType: 'verbis.campaigns.campaign.created.v1' },
    });
    // Observe the real JetStream acknowledgement for this event, independent of other tenants.
    const publish = vi.spyOn(app.get(NatsService), 'publish');

    // Simulate: published to NATS, then the process died before marking the row.
    await owner.outboxEvent.update({
      where: { id: row.id },
      data: { status: 'pending', publishedAt: null },
    });
    await drain();

    const callIndex = publish.mock.calls.findIndex((call) => call[2].msgId === row.id);
    expect(callIndex).toBeGreaterThanOrEqual(0);
    const result = publish.mock.results[callIndex];
    expect(result?.type).toBe('return');
    if (result?.type !== 'return') throw new Error('No JetStream acknowledgement for replay');
    expect(await result.value).toMatchObject({ duplicate: true });
    publish.mockRestore();
    expect(await owner.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'published',
      attempts: 2,
    });
  });

  it('retries with backoff while NATS is unreachable, dead-letters, and can be requeued', async () => {
    await drain();
    const tenant = await createTenant(owner, kit, uniqueSlug('dead'));
    await createCampaign(tenant, 'Unlucky');
    const ids = (
      await owner.outboxEvent.findMany({
        where: { tenantId: tenant.tenantId },
        select: { id: true },
      })
    ).map((row) => row.id);

    // This case starts with due events. Host and container clocks can differ,
    // so eligibility must be explicit before testing the unreachable publisher.
    await owner.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: { availableAt: new Date(0) },
    });

    const unreachable = new NatsService(
      integrationEnv(kit.jwks, { NATS_URL: 'nats://127.0.0.1:1' }),
    );
    const relay = new OutboxRelay(
      new SqlOutboxStore(app.get(PrismaService)),
      {
        publish: async (subject, data, options) => ({
          duplicate: (await unreachable.publish(subject, data, options)).duplicate,
        }),
      },
      {
        batchSize: 100,
        leaseSeconds: 30,
        maxAttempts: 2,
        baseBackoffMs: 60_000,
        maxBackoffMs: 60_000,
      },
    );
    try {
      const first = await relay.runOnce();
      expect(first).toMatchObject({
        claimed: ids.length,
        published: 0,
        retried: ids.length,
        dead: 0,
      });
      const retrying = await owner.outboxEvent.findMany({ where: { id: { in: ids } } });
      for (const row of retrying) {
        expect(row).toMatchObject({ status: 'pending', attempts: 1, lockedUntil: null });
        expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
        expect(row.lastError).toBeTruthy();
      }
      // Not due yet: a second pass leaves them alone.
      expect((await relay.runOnce()).claimed).toBe(0);

      await owner.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { availableAt: new Date(0) },
      });
      expect(await relay.runOnce()).toMatchObject({ dead: ids.length });
      expect(await owner.outboxEvent.count({ where: { id: { in: ids }, status: 'dead' } })).toBe(
        ids.length,
      );
    } finally {
      await unreachable.onModuleDestroy();
    }

    const auth = await tenant.auth();
    const status = (
      await app.inject({ method: 'GET', url: '/v1/admin/outbox', headers: auth })
    ).json<{ dead: number; deadEvents: { id: string }[] }>();
    expect(status.dead).toBe(ids.length);
    const target = ids[0] ?? '';
    const requeued = await app.inject({
      method: 'POST',
      url: `/v1/admin/outbox/${target}/requeue`,
      headers: auth,
    });
    expect(requeued.json()).toEqual({ requeued: true });
    expect(await owner.outboxEvent.findUniqueOrThrow({ where: { id: target } })).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
    // Another tenant cannot requeue it.
    const other = await createTenant(owner, kit, uniqueSlug('other'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/outbox/${ids[1] ?? ''}/requeue`,
          headers: await other.auth(),
        })
      ).statusCode,
    ).toBe(404);
    await drain();
    expect((await owner.outboxEvent.findUniqueOrThrow({ where: { id: target } })).status).toBe(
      'published',
    );
  });
});

describe('idempotent consumers (at-least-once delivery)', () => {
  let consumerApp: NestFastifyApplication;

  beforeAll(async () => {
    consumerApp = await startApp(integrationEnv(kit.jwks, { EVENT_CONSUMERS_ENABLED: 'true' }));
  });
  afterAll(async () => {
    await consumerApp.close();
  });

  const count = (tenantId: string, eventType: string) =>
    owner.analyticsEventCount
      .findMany({ where: { tenantId, eventType } })
      .then((rows) => rows.reduce((sum, row) => sum + row.count, 0));

  it('applies each event exactly once, even when it is delivered again', async () => {
    await drain();
    const tenant = await createTenant(owner, kit, uniqueSlug('consume'));
    await createCampaign(tenant, 'Counted');
    await drain();
    const type = 'verbis.campaigns.campaign.created.v1';
    expect(
      await eventually(
        () => count(tenant.tenantId, type),
        (n) => n === 1,
      ),
    ).toBe(1);

    // Redeliver the same envelope with a new Nats-Msg-Id (beyond JetStream's dedupe window).
    const message = await jsm.streams.getMessage('DOMAIN', { last_by_subj: type });
    const consumer = await jsm.consumers.info('DOMAIN', 'analytics-event-counter');
    const h = natsHeaders();
    h.set('verbis-tenant-id', tenant.tenantId);
    const js = await consumerApp.get(NatsService).jetstream();
    await js.publish(type, message?.data, { msgID: `redelivery-${uniqueSlug('r')}`, headers: h });
    await js.publish(type, message?.data, { msgID: `redelivery-${uniqueSlug('r')}`, headers: h });

    const envelope = EventEnvelopeSchema.parse(JSON.parse(decoder.decode(message?.data)));
    await eventually(
      () => jsm.consumers.info('DOMAIN', 'analytics-event-counter'),
      (info) =>
        info.num_pending === 0 &&
        info.num_ack_pending === 0 &&
        info.delivered.stream_seq >= consumer.delivered.stream_seq + 2,
    );
    expect(await count(tenant.tenantId, type)).toBe(1);
    expect(
      await owner.processedEvent.count({
        where: { consumer: 'analytics-event-counter', eventId: envelope.id },
      }),
    ).toBe(1);

    const api = await app.inject({
      method: 'GET',
      url: `/v1/analytics/event-counts?eventType=${type}`,
      headers: await tenant.auth(),
    });
    expect(
      api.json<{ data: { count: number }[] }>().data.reduce((sum, row) => sum + row.count, 0),
    ).toBe(1);
  });

  it('sends poison messages to the dead-letter stream without retrying', async () => {
    const js = await consumerApp.get(NatsService).jetstream();
    await js.publish(
      'verbis.campaigns.campaign.created.v1',
      new TextEncoder().encode('{not json'),
      { msgID: `poison-${uniqueSlug('p')}` },
    );
    const dlq = await eventually(
      () =>
        jsm.streams
          .getMessage('DLQ', { last_by_subj: 'verbis.dlq.analytics-event-counter' })
          .catch(() => null),
      (msg) => msg !== null && decoder.decode(msg.data) === '{not json',
    );
    expect(dlq?.header.get('verbis-dlq-reason')).toBe('invalid envelope');
  });
});

describe('in-process relay loop', () => {
  it('publishes new events automatically when OUTBOX_RELAY_ENABLED', async () => {
    await drain();
    const relayApp = await startApp(
      integrationEnv(kit.jwks, { OUTBOX_RELAY_ENABLED: 'true', OUTBOX_POLL_INTERVAL_MS: '50' }),
    );
    try {
      const tenant = await createTenant(owner, kit, uniqueSlug('loop'));
      await createCampaign(tenant, 'Looped');
      const statuses = await eventually(
        () =>
          owner.outboxEvent.findMany({
            where: { tenantId: tenant.tenantId },
            select: { status: true },
          }),
        (rows) => rows.length > 0 && rows.every((row) => row.status === 'published'),
      );
      expect(statuses.length).toBeGreaterThanOrEqual(2);
    } finally {
      await relayApp.close();
    }
  });
});
