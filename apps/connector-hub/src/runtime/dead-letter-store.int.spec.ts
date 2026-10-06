import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BackpressureError, parseInteractionEvent } from '@verbis/sdk-connector';

import { JetStreamDeadLetterStore, type DeadLetterRecord } from './dead-letter-store.js';

const TENANT = '0190f000-0000-7000-8000-0000000000aa';
const OTHER = '0190f000-0000-7000-8000-0000000000bb';
const CONNECTOR = '0190f000-0000-7000-8000-0000000000c1';
const STREAM = 'VERBIS_HUB_DLQ_TEST';

function record(id: string, tenantId = TENANT): DeadLetterRecord {
  return {
    id,
    reason: 'exhausted',
    error: 'http_503',
    deadLetteredAt: '2026-10-06T08:00:00.000Z',
    item: {
      slug: 'acme',
      tenantId,
      connectorId: CONNECTOR,
      event: parseInteractionEvent({
        eventId: `e-${id}`,
        type: 'connected',
        occurredAt: '2026-10-06T07:59:00.000Z',
        platformInteractionId: `p-${id}`,
        channel: 'voice',
        direction: 'inbound',
        agent: { id: 'agent-1' },
      }),
      maxConcurrent: {},
    },
  };
}

/** Durable hub DLQ against a real NATS JetStream (Testcontainers). */
describe('JetStream dead-letter store (integration)', () => {
  let container: StartedTestContainer;
  let server: string;
  const store = () =>
    new JetStreamDeadLetterStore({
      servers: [server],
      stream: STREAM,
      maxAgeHours: 1,
      replicas: 1,
    });

  beforeAll(async () => {
    container = await new GenericContainer('nats:2.11-alpine')
      .withCommand(['-js'])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
      .start();
    server = `nats://${container.getHost()}:${String(container.getMappedPort(4222))}`;
  }, 120_000);

  afterAll(async () => {
    await container.stop();
  });

  it('survives a hub restart, dedupes, replays per tenant and removes only accepted records', async () => {
    const writer = store();
    await writer.put(record('1'));
    await writer.put(record('1')); // same id within the duplicate window
    await writer.put(record('2', OTHER));
    await writer.put(record('3'));
    await writer.close();

    const nc = await connect({ servers: server });
    const jsm = await jetstreamManager(nc);
    const info = await jsm.streams.info(STREAM);
    expect(info.state.messages).toBe(3);
    expect(info.config).toMatchObject({
      retention: 'workqueue',
      storage: 'file',
      deny_delete: true,
    });

    // A fresh instance (as after a restart) still sees the records.
    const reader = store();
    await expect(
      reader.replay(TENANT, 10, () => {
        throw new BackpressureError('delivery queue full');
      }),
    ).rejects.toBeInstanceOf(BackpressureError);
    await new Promise((r) => setTimeout(r, 50));
    const seen: string[] = [];
    // The nak'ed record is redelivered; replay is bounded by `limit`.
    expect(await reader.replay(TENANT, 1, (item) => seen.push(item.event.eventId))).toBe(1);
    expect(await reader.replay(TENANT, 10, (item) => seen.push(item.event.eventId))).toBe(1);
    expect(seen.sort()).toEqual(['e-1', 'e-3']);
    expect(await reader.replay(TENANT, 10, () => undefined)).toBe(0);
    expect((await jsm.streams.info(STREAM)).state.messages).toBe(1);
    const other: string[] = [];
    expect(await reader.replay(OTHER, 10, (item) => other.push(item.tenantId))).toBe(1);
    expect(other).toEqual([OTHER]);
    expect((await jsm.streams.info(STREAM)).state.messages).toBe(0);
    await reader.close();
    await nc.close();
  }, 60_000);
});
