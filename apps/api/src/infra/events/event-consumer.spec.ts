import { describe, expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';

import {
  type Delivery,
  type EventHandler,
  IdempotentProcessor,
  type TenantRunner,
} from './event-consumer.js';

import type { TransactionClient } from '../database/prisma.service.js';

const EVENT = {
  id: '01928f3a-0000-7000-8000-0000000000e1',
  type: 'verbis.campaigns.campaign.created.v1',
  tenantId: '01928f3a-0000-7000-8000-000000000001',
  aggregate: { type: 'Campaign', id: 'c-1' },
  occurredAt: '2026-10-01T10:00:00.000Z',
  correlationId: 'corr-1',
  actor: 'user:u-1',
  payload: {},
};

function delivery(
  data: unknown,
  deliveryCount = 1,
): Delivery & { acked: number; naked: number[]; termed: string[] } {
  const d = {
    subject: EVENT.type,
    data: new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)),
    deliveryCount,
    headers: { 'Nats-Msg-Id': EVENT.id },
    acked: 0,
    naked: [] as number[],
    termed: [] as string[],
    ack: () => {
      d.acked += 1;
    },
    nak: (ms: number) => {
      d.naked.push(ms);
    },
    term: (reason: string) => {
      d.termed.push(reason);
    },
  };
  return d;
}

/** Fake tenant runner with an in-memory processed_events table. */
function runner() {
  const processed = new Set<string>();
  const tenants: string[] = [];
  const run: TenantRunner = async <T>(
    tenantId: string,
    fn: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> => {
    tenants.push(tenantId);
    const snapshot = new Set(processed);
    const tx = {
      $executeRaw: (_strings: TemplateStringsArray, consumer: string, eventId: string) => {
        const key = `${consumer}:${eventId}`;
        if (processed.has(key)) return Promise.resolve(0);
        processed.add(key);
        return Promise.resolve(1);
      },
    } as unknown as TransactionClient;
    try {
      return await fn(tx);
    } catch (error) {
      // rollback
      processed.clear();
      for (const key of snapshot) processed.add(key);
      throw error;
    }
  };
  return { run, processed, tenants };
}

const handler = (handle: EventHandler['handle']): EventHandler => ({
  name: 'test-consumer',
  stream: 'DOMAIN',
  filterSubjects: ['verbis.>'],
  maxDeliver: 3,
  handle,
});

describe('IdempotentProcessor', () => {
  it('processes once, then acknowledges redeliveries as duplicates', async () => {
    const { run, tenants } = runner();
    const handle = vi.fn(() => Promise.resolve());
    const processor = new IdempotentProcessor(run, vi.fn());
    const first = delivery(EVENT);
    expect(await processor.process(handler(handle), first)).toBe('processed');
    const again = delivery(EVENT, 2);
    expect(await processor.process(handler(handle), again)).toBe('duplicate');
    expect(handle).toHaveBeenCalledTimes(1);
    expect([first.acked, again.acked]).toEqual([1, 1]);
    expect(tenants).toEqual([EVENT.tenantId, EVENT.tenantId]);
  });

  it('runs the handler in a service context of the event tenant', async () => {
    const { run } = runner();
    let seen: unknown;
    await new IdempotentProcessor(run, vi.fn()).process(
      handler(() => {
        seen = requestContext.get()?.principal;
        return Promise.resolve();
      }),
      delivery(EVENT),
    );
    expect(seen).toEqual({
      type: 'service',
      id: 'consumer:test-consumer',
      tenantId: EVENT.tenantId,
      scopes: [],
    });
  });

  it('naks failures with backoff and rolls back the dedupe row', async () => {
    const { run, processed } = runner();
    const processor = new IdempotentProcessor(run, vi.fn(), (n) => n * 100);
    const failing = delivery(EVENT, 1);
    expect(
      await processor.process(
        handler(() => Promise.reject(new Error('db'))),
        failing,
      ),
    ).toBe('retry');
    expect(failing.naked).toEqual([100]);
    expect(processed.size).toBe(0);
  });

  it('dead-letters after max deliveries', async () => {
    const { run } = runner();
    const deadLetter = vi.fn(() => Promise.resolve());
    const last = delivery(EVENT, 3);
    expect(
      await new IdempotentProcessor(run, deadLetter).process(
        handler(() => Promise.reject(new Error('boom'))),
        last,
      ),
    ).toBe('dead');
    expect(deadLetter).toHaveBeenCalledWith('test-consumer', last, 'Error: boom');
    expect(last.termed).toEqual(['max deliveries reached']);
  });

  it('terminates poison messages without retrying', async () => {
    const { run, tenants } = runner();
    const deadLetter = vi.fn(() => Promise.resolve());
    const processor = new IdempotentProcessor(run, deadLetter);
    for (const bad of ['not json', { ...EVENT, id: 'x' }]) {
      const d = delivery(bad);
      expect(
        await processor.process(
          handler(() => Promise.resolve()),
          d,
        ),
      ).toBe('rejected');
      expect(d.termed).toEqual(['invalid envelope']);
    }
    expect(tenants).toEqual([]);
  });

  it('uses exponential default retry delays', async () => {
    const { run } = runner();
    const d = delivery(EVENT, 2);
    await new IdempotentProcessor(run, vi.fn()).process(
      handler(() => Promise.reject(new Error('x'))),
      d,
    );
    expect(d.naked).toEqual([2_000]);
  });
});
