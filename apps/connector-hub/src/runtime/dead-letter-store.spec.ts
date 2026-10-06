import { describe, expect, it } from 'vitest';

import { parseInteractionEvent } from '@verbis/sdk-connector';

import {
  MemoryDeadLetterStore,
  parseDeadLetterRecord,
  type DeadLetterRecord,
} from './dead-letter-store.js';

const TENANT = '0190f000-0000-7000-8000-0000000000aa';
const OTHER = '0190f000-0000-7000-8000-0000000000bb';
const CONNECTOR = '0190f000-0000-7000-8000-0000000000c1';

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
      maxConcurrent: { voice: 1 },
    },
  };
}

describe('dead-letter records', () => {
  it('round-trips through JSON and validates the event', () => {
    const original = record('1');
    expect(parseDeadLetterRecord(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('rejects tampered or foreign-shaped records', () => {
    const raw = JSON.parse(JSON.stringify(record('1'))) as Record<string, unknown>;
    expect(() => parseDeadLetterRecord({ ...raw, reason: 'other' })).toThrow();
    expect(() => parseDeadLetterRecord({ ...raw, extra: true })).toThrow();
    expect(() =>
      parseDeadLetterRecord({ ...raw, item: { ...(raw['item'] as object), tenantId: 'acme' } }),
    ).toThrow();
    expect(() =>
      parseDeadLetterRecord({ ...raw, item: { ...(raw['item'] as object), event: { x: 1 } } }),
    ).toThrow();
  });
});

describe('MemoryDeadLetterStore', () => {
  it('is not durable, is bounded and replays per tenant in order', async () => {
    const store = new MemoryDeadLetterStore(3);
    expect(store.durable).toBe(false);
    for (const [id, tenant] of [
      ['1', TENANT],
      ['2', OTHER],
      ['3', TENANT],
      ['4', TENANT],
    ] as const)
      await store.put(record(id, tenant));
    expect(store.records.map((r) => r.id)).toEqual(['2', '3', '4']);
    const seen: string[] = [];
    expect(
      await store.replay(TENANT, 1, (item) => {
        seen.push(item.event.eventId);
      }),
    ).toBe(1);
    expect(seen).toEqual(['e-3']);
    expect(store.records.map((r) => r.id)).toEqual(['2', '4']);
    await store.close();
  });
});
