import { describe, expect, it } from 'vitest';

import { ANOMALY_THRESHOLD, BLOCK_THRESHOLD, LaunchAttempts } from './launch-attempts.js';

import type { RedisService } from '../../infra/redis/redis.service.js';

function fakeRedis() {
  const store = new Map<string, number>();
  const client = {
    mget: (...keys: string[]) =>
      Promise.resolve(keys.map((k) => (store.has(k) ? String(store.get(k)) : null))),
    multi() {
      const ops: (() => [null, number])[] = [];
      const chain = {
        incr(k: string) {
          ops.push(() => {
            store.set(k, (store.get(k) ?? 0) + 1);
            return [null, store.get(k) ?? 0];
          });
          return chain;
        },
        expire() {
          ops.push(() => [null, 1]);
          return chain;
        },
        exec: () => Promise.resolve(ops.map((op) => op())),
      };
      return chain;
    },
  };
  return { client } as unknown as RedisService;
}

describe('LaunchAttempts', () => {
  const key = { tenantId: 't', userId: 'u', ip: '10.0.0.1' };

  it('raises the anomaly exactly once at the threshold, then blocks', async () => {
    const attempts = new LaunchAttempts(fakeRedis());
    const anomalies: boolean[] = [];
    for (let n = 1; n <= BLOCK_THRESHOLD; n += 1) {
      expect(await attempts.blocked(key)).toBe(false);
      anomalies.push((await attempts.fail(key)).anomaly);
    }
    expect(anomalies.filter(Boolean)).toHaveLength(1);
    expect(anomalies[ANOMALY_THRESHOLD - 1]).toBe(true);
    expect(await attempts.blocked(key)).toBe(true);
    expect(await attempts.blocked({ ...key, userId: 'v', ip: '10.0.0.2' })).toBe(false);
  });

  it('fails open on Redis errors (launch checks still fail closed)', async () => {
    const broken = {
      client: {
        mget: () => Promise.reject(new Error('down')),
        multi: () => ({
          incr: () => {
            throw new Error('down');
          },
        }),
      },
    } as unknown as RedisService;
    const attempts = new LaunchAttempts(broken);
    expect(await attempts.blocked(key)).toBe(false);
    expect(await attempts.fail(key)).toEqual({ anomaly: false, count: 0 });
  });
});
