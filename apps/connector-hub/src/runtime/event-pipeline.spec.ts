import { describe, expect, it } from 'vitest';

import {
  BackpressureError,
  ConnectorError,
  parseInteractionEvent,
  type InteractionEvent,
} from '@verbis/sdk-connector';

import { FakeVerbisApi, TENANT_ID, TENANT_SLUG } from '../test/fake-api.js';

import { MemoryDeadLetterStore, type DeadLetterStore } from './dead-letter-store.js';
import { EventPipeline, type PipelineItem } from './event-pipeline.js';

const CONNECTOR = '0190f000-0000-7000-8000-0000000000c1';
let seq = 0;
function event(
  type: InteractionEvent['type'],
  pid: string,
  channel: InteractionEvent['channel'],
  agent = 'p-agent',
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return parseInteractionEvent({
    eventId: `e-${String(seq)}`,
    type,
    occurredAt: '2026-10-01T10:00:00.000Z',
    platformInteractionId: pid,
    channel,
    direction: 'inbound',
    agent: { id: agent },
    ...extra,
  });
}

function setup(deadLetters: DeadLetterStore = new MemoryDeadLetterStore()) {
  const api = new FakeVerbisApi();
  api.users = {
    'p-agent': '0190f000-0000-7000-8000-0000000000u1',
    'p-other': '0190f000-0000-7000-8000-0000000000u2',
  };
  const pipeline = new EventPipeline(api, {
    capacity: 100,
    concurrency: 4,
    sleep: () => Promise.resolve(),
    deadLetters,
    now: () => new Date('2026-10-06T08:00:00.000Z'),
  });
  const offer = (e: InteractionEvent) => {
    pipeline.offer({
      slug: TENANT_SLUG,
      tenantId: TENANT_ID,
      connectorId: CONNECTOR,
      event: e,
      maxConcurrent: { chat: 3, email: 1 },
    });
  };
  return { api, pipeline, offer };
}

describe('EventPipeline', () => {
  it('launches once per interaction when connected; 3 chats + 1 email ⇒ 4 sessions', async () => {
    const { api, pipeline, offer } = setup();
    for (const [pid, channel] of [
      ['c1', 'chat'],
      ['c2', 'chat'],
      ['c3', 'chat'],
      ['m1', 'email'],
    ] as const) {
      offer(event('interactionOffered', pid, channel));
      offer(event('connected', pid, channel));
      offer(event('held', pid, channel));
      offer(event('resumed', pid, channel));
      offer(event('connected', pid, channel));
    }
    await pipeline.drain();
    expect(api.launches).toHaveLength(4);
    expect(new Set(api.launches.map((l) => l.interactionId)).size).toBe(4);
    expect(pipeline.workload.snapshot(TENANT_ID, '0190f000-0000-7000-8000-0000000000u1')).toEqual({
      chat: 3,
      email: 1,
    });
  });

  it('does not launch for unmapped agents or offered-only interactions', async () => {
    const { api, pipeline, offer } = setup();
    offer(event('connected', 'x1', 'voice', 'p-unknown'));
    offer(event('interactionOffered', 'x2', 'voice'));
    await pipeline.drain();
    expect(api.launches).toEqual([]);
    expect(api.ingested).toHaveLength(2);
  });

  it('launches a fresh session for the receiving agent after a transfer', async () => {
    const { api, pipeline, offer } = setup();
    offer(event('connected', 't1', 'voice'));
    offer(event('transferred', 't1', 'voice', 'p-agent', { transferTo: { id: 'p-other' } }));
    offer(event('connected', 't1', 'voice', 'p-other'));
    await pipeline.drain();
    expect(api.launches.map((l) => l.userId)).toEqual([
      '0190f000-0000-7000-8000-0000000000u1',
      '0190f000-0000-7000-8000-0000000000u2',
    ]);
  });

  it('frees workload on end and retries API outages', async () => {
    const { api, pipeline, offer } = setup();
    api.failIngest = 2;
    offer(event('connected', 'e1', 'chat'));
    offer(event('ended', 'e1', 'chat'));
    await pipeline.drain();
    expect(api.ingested.map((i) => i.event.type)).toEqual(['connected', 'ended']);
    expect(pipeline.workload.snapshot(TENANT_ID, '0190f000-0000-7000-8000-0000000000u1')).toEqual(
      {},
    );
    expect(pipeline.stats().retried).toBe(2);
  });

  it('persists dead letters durably and replays them for the owning tenant only', async () => {
    const store = new MemoryDeadLetterStore();
    const { api, pipeline, offer } = setup(store);
    api.failIngest = 8; // exhausts the default 8 attempts
    offer(event('connected', 'd1', 'voice'));
    await pipeline.drain();
    await new Promise((r) => setImmediate(r));
    expect(api.ingested).toEqual([]);
    expect(store.records).toHaveLength(1);
    const record = store.records[0];
    expect(record).toMatchObject({
      reason: 'exhausted',
      error: 'http_503',
      deadLetteredAt: '2026-10-06T08:00:00.000Z',
      item: { tenantId: TENANT_ID, connectorId: CONNECTOR },
    });
    expect(record?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(pipeline.deadLetterStats()).toEqual({
      durable: false,
      persisted: 1,
      persistFailures: 0,
    });

    expect(await pipeline.replayDeadLetters('0190f000-0000-7000-8000-0000000000bb', 10)).toBe(0);
    expect(store.records).toHaveLength(1);
    expect(await pipeline.replayDeadLetters(TENANT_ID, 10)).toBe(1);
    await pipeline.drain();
    expect(store.records).toEqual([]);
    expect(api.ingested.map((i) => i.event.platformInteractionId)).toEqual(['d1']);
    expect(api.launches).toHaveLength(1);
  });

  it('marks non-retryable rejections and counts dead letters that could not be persisted', async () => {
    const failing: DeadLetterStore = {
      durable: true,
      put: () => Promise.reject(new Error('nats down')),
      replay: () => Promise.resolve(0),
      close: () => Promise.resolve(),
    };
    const { api, pipeline, offer } = setup(failing);
    api.ingest = () => Promise.reject(new ConnectorError('bad', 'payload_rejected', false));
    offer(event('connected', 'r1', 'chat'));
    await pipeline.drain();
    await new Promise((r) => setImmediate(r));
    expect(pipeline.deadLetterStats()).toEqual({ durable: true, persisted: 0, persistFailures: 1 });
  });

  it('persists queued events on shutdown instead of losing them', async () => {
    const store = new MemoryDeadLetterStore();
    const closed: string[] = [];
    store.close = () => {
      closed.push('closed');
      return Promise.resolve();
    };
    const { api, pipeline, offer } = setup(store);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const ingest = api.ingest.bind(api);
    api.ingest = async (...args) => {
      await gate;
      return ingest(...args);
    };
    offer(event('connected', 's1', 'voice'));
    offer(event('ended', 's1', 'voice'));
    offer(event('connected', 's2', 'voice'));
    pipeline.close();
    const shutdown = pipeline.persistPendingAndClose();
    release();
    await shutdown;
    await pipeline.drain();
    // Heads of both interactions were already in flight and completed; only the queued
    // follow-up of s1 had not started and is persisted.
    expect(store.records.map((r) => [r.reason, r.item.event.type])).toEqual([
      ['shutdown', 'ended'],
    ]);
    expect(api.ingested.map((i) => i.event.platformInteractionId).sort()).toEqual(['s1', 's2']);
    expect(closed).toEqual(['closed']);
  });

  it('keeps a dead letter in the store when replay hits backpressure', async () => {
    const store = new MemoryDeadLetterStore();
    const item: PipelineItem = {
      slug: TENANT_SLUG,
      tenantId: TENANT_ID,
      connectorId: CONNECTOR,
      event: event('connected', 'b1', 'voice'),
      maxConcurrent: {},
    };
    await store.put({
      id: 'x',
      reason: 'exhausted',
      error: 'http_503',
      deadLetteredAt: '2026-10-06T08:00:00.000Z',
      item,
    });
    const { pipeline } = setup(store);
    pipeline.close();
    await expect(pipeline.replayDeadLetters(TENANT_ID, 5)).rejects.toBeInstanceOf(
      BackpressureError,
    );
    expect(store.records).toHaveLength(1);
  });
});
