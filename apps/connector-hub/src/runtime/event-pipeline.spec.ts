import { describe, expect, it } from 'vitest';

import { parseInteractionEvent, type InteractionEvent } from '@verbis/sdk-connector';

import { FakeVerbisApi, TENANT_ID, TENANT_SLUG } from '../test/fake-api.js';

import { EventPipeline } from './event-pipeline.js';

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

function setup() {
  const api = new FakeVerbisApi();
  api.users = {
    'p-agent': '0190f000-0000-7000-8000-0000000000u1',
    'p-other': '0190f000-0000-7000-8000-0000000000u2',
  };
  const pipeline = new EventPipeline(api, {
    capacity: 100,
    concurrency: 4,
    sleep: () => Promise.resolve(),
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
});
