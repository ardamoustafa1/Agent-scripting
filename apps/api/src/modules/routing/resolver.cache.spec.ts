import { describe, expect, it, vi } from 'vitest';

import { deriveCode } from '../campaigns/campaigns.repository.js';

import { ResolverCache, reviveSnapshot } from './resolver.cache.js';

import type { CampaignSnapshot } from './domain/resolver.js';
import type { ApiEnv } from '../../env.js';
import type { RedisService } from '../../infra/redis/redis.service.js';

const snapshot: CampaignSnapshot = {
  campaign: {
    id: 'c',
    code: 'C',
    status: 'active',
    channels: ['voice'],
    startsAt: new Date('2026-01-01T00:00:00Z'),
    endsAt: null,
    workingHours: null,
  },
  assignments: [
    {
      id: 'a',
      scriptId: 's',
      scriptStatus: 'active',
      priority: 1,
      effectiveFrom: new Date('2026-02-01T00:00:00Z'),
      effectiveTo: null,
      conditions: { channels: ['voice'] },
      expression: null,
      versionPolicy: 'latestPublished',
      pinnedVersionId: null,
      variants: null,
      createdAt: new Date('2026-01-05T00:00:00Z'),
    },
  ],
  versions: [
    { id: 'v', scriptId: 's', number: 1, semver: '1.0.0', checksum: 'x', state: 'published' },
  ],
};

function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: vi.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve('OK');
    }),
    incr: vi.fn((k: string) => {
      const next = Number(store.get(k) ?? '0') + 1;
      store.set(k, String(next));
      return Promise.resolve(next);
    }),
  };
  return { redis: { client } as unknown as RedisService, client };
}

describe('ResolverCache', () => {
  const env = { RESOLVER_CACHE_TTL_SECONDS: 60 } as ApiEnv;

  it('round-trips snapshots with dates intact', async () => {
    const { redis, client } = fakeRedis();
    const cache = new ResolverCache(redis, env);
    const gen = await cache.generation('t');
    expect(gen).toBe('0');
    await cache.set('t', 'c', '0', snapshot);
    expect(client.set).toHaveBeenCalledWith('resolver:snap:t:0:c', expect.any(String), 'EX', 60);
    expect(await cache.get('t', 'c', '0')).toEqual(snapshot);
  });

  it('invalidation moves the generation so old entries are unreachable', async () => {
    const { redis } = fakeRedis();
    const cache = new ResolverCache(redis, env);
    await cache.set('t', 'c', '0', snapshot);
    await cache.invalidate('t');
    const gen = await cache.generation('t');
    expect(gen).toBe('1');
    expect(await cache.get('t', 'c', gen ?? '')).toBeUndefined();
  });

  it('degrades to "no cache" when Redis fails', async () => {
    const failing = {
      client: {
        get: () => Promise.reject(new Error('down')),
        set: () => Promise.reject(new Error('down')),
        incr: () => Promise.reject(new Error('down')),
      },
    } as unknown as RedisService;
    const cache = new ResolverCache(failing, env);
    expect(await cache.generation('t')).toBeUndefined();
    expect(await cache.get('t', 'c', '0')).toBeUndefined();
    await expect(cache.set('t', 'c', '0', snapshot)).resolves.toBeUndefined();
    await expect(cache.invalidate('t')).rejects.toThrow('down');
  });

  it('reviveSnapshot restores Date fields', () => {
    const revived = reviveSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as Parameters<typeof reviveSnapshot>[0],
    );
    expect(revived.assignments[0]?.effectiveFrom).toBeInstanceOf(Date);
    expect(revived.campaign.startsAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('campaign code derivation', () => {
  it.each([
    ['Kart Satış Q4', 'KART_SATIS_Q4'],
    ['  Tahsilat — Gecikmiş  ', 'TAHSILAT_GECIKMIS'],
    ['İade/İptal', 'IADE_IPTAL'],
    ['***', 'CAMPAIGN'],
  ])('%s → %s', (name, code) => {
    expect(deriveCode(name)).toBe(code);
  });
});
