import { describe, expect, it } from 'vitest';

import { BackpressureError, ConnectorError } from '@verbis/sdk-connector';

import { DeliveryQueue } from './delivery-queue.js';

const instant = () => Promise.resolve();

describe('DeliveryQueue', () => {
  it('applies backpressure at capacity instead of buffering unboundedly', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const queue = new DeliveryQueue<number>({
      capacity: 2,
      concurrency: 1,
      key: () => 'k',
      handle: () => gate,
      sleep: instant,
    });
    queue.offer(1);
    queue.offer(2);
    expect(() => {
      queue.offer(3);
    }).toThrow(BackpressureError);
    expect(queue.stats()).toMatchObject({ depth: 2, capacity: 2 });
    release();
    await queue.drain();
    queue.offer(3);
    await queue.drain();
    expect(queue.stats()).toMatchObject({ depth: 0, delivered: 3 });
  });

  it('keeps per-key order while running keys in parallel', async () => {
    const seen: string[] = [];
    const queue = new DeliveryQueue<{ k: string; n: number }>({
      capacity: 100,
      concurrency: 4,
      key: (i) => i.k,
      handle: async (i) => {
        await new Promise((r) => setTimeout(r, i.n % 2 === 0 ? 2 : 0));
        seen.push(`${i.k}${String(i.n)}`);
      },
      sleep: instant,
    });
    for (let n = 1; n <= 4; n += 1) for (const k of ['a', 'b']) queue.offer({ k, n });
    await queue.drain();
    expect(seen.filter((s) => s.startsWith('a'))).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(seen.filter((s) => s.startsWith('b'))).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('retries retryable failures with backoff and dead-letters the rest', async () => {
    let failures = 2;
    const dead: number[] = [];
    const reasons = new Map<number, string>();
    const delays: number[] = [];
    const queue = new DeliveryQueue<number>({
      capacity: 10,
      concurrency: 1,
      maxAttempts: 3,
      key: String,
      handle: (n) => {
        if (n === 1 && failures-- > 0)
          return Promise.reject(new ConnectorError('503', 'http_503', true));
        if (n === 2) return Promise.reject(new ConnectorError('422', 'bad', false));
        if (n === 3) return Promise.reject(new ConnectorError('503', 'http_503', true));
        return Promise.resolve();
      },
      onDeadLetter: (n, _error, reason) => {
        dead.push(n);
        reasons.set(n, reason);
      },
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    });
    [1, 2, 3].forEach((n) => {
      queue.offer(n);
    });
    await queue.drain();
    expect(dead.sort()).toEqual([2, 3]);
    expect(Object.fromEntries(reasons)).toEqual({ 2: 'rejected', 3: 'exhausted' });
    expect(queue.stats()).toMatchObject({ delivered: 1, deadLettered: 2, retried: 4 });
    expect(delays.every((d) => d > 0)).toBe(true);
  });

  it('hands back undelivered items after close, keeping in-flight heads with their worker', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const handled: string[] = [];
    const queue = new DeliveryQueue<{ k: string; n: number }>({
      capacity: 10,
      concurrency: 1,
      key: (i) => i.k,
      handle: async (i) => {
        handled.push(`${i.k}${String(i.n)}`);
        await gate;
      },
      sleep: instant,
    });
    queue.offer({ k: 'a', n: 1 });
    queue.offer({ k: 'a', n: 2 });
    queue.offer({ k: 'b', n: 1 });
    queue.close();
    const pending = queue.takePending().map((i) => `${i.k}${String(i.n)}`);
    expect(pending.sort()).toEqual(['a2', 'b1']);
    expect(queue.stats()).toMatchObject({ depth: 1, inflight: 1 });
    release();
    await queue.drain();
    expect(handled).toEqual(['a1']);
    expect(queue.stats()).toMatchObject({ depth: 0, delivered: 1 });
  });

  it('refuses new items after close', () => {
    const queue = new DeliveryQueue<number>({
      capacity: 1,
      concurrency: 1,
      key: String,
      handle: instant,
    });
    queue.close();
    expect(() => {
      queue.offer(1);
    }).toThrow(BackpressureError);
  });
});
