import { describe, expect, it, vi } from 'vitest';

import { Keyring } from '../identity/crypto/keyring.js';

import { RuntimeCipher } from './runtime-cipher.js';
import {
  TRANSCRIPT_TTL_SECONDS,
  TRANSCRIPT_WINDOW,
  TranscriptStore,
  type TranscriptLine,
} from './transcript.store.js';

import type { RedisService } from '../../infra/redis/redis.service.js';

const TENANT = '0190f000-0000-7000-8000-00000000aaaa';
const OTHER_TENANT = '0190f000-0000-7000-8000-00000000bbbb';
const CALL = '0190f000-0000-7000-8000-00000000cccc';
const line = (segmentId: string, text = 'Aboneliğimi iptal etmek istiyorum'): TranscriptLine => ({
  segmentId,
  speaker: 'customer',
  text,
  final: true,
  at: '2026-10-22T10:00:00.000Z',
});

/** A tiny in-memory Redis with the commands the store uses. */
function harness() {
  const lists = new Map<string, string[]>();
  const sets = new Map<string, Set<string>>();
  const ttl = new Map<string, number>();
  const multi = () => {
    const ops: (() => unknown)[] = [];
    const chain = {
      sadd: (key: string, member: string) => {
        ops.push(() => {
          const set = sets.get(key) ?? new Set();
          const added = set.has(member) ? 0 : 1;
          set.add(member);
          sets.set(key, set);
          return added;
        });
        return chain;
      },
      rpush: (key: string, value: string) => {
        ops.push(() => {
          const list = [...(lists.get(key) ?? []), value];
          lists.set(key, list);
          return list.length;
        });
        return chain;
      },
      ltrim: (key: string, start: number) => {
        ops.push(() => {
          lists.set(key, (lists.get(key) ?? []).slice(start));
          return 'OK';
        });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          ttl.set(key, seconds);
          return 1;
        });
        return chain;
      },
      exec: () => Promise.resolve(ops.map((op) => [null, op()])),
    };
    return chain;
  };
  const client = {
    sismember: vi.fn((key: string, member: string) =>
      Promise.resolve(sets.get(key)?.has(member) ? 1 : 0),
    ),
    lrange: vi.fn((key: string) => Promise.resolve(lists.get(key) ?? [])),
    del: vi.fn((...keys: string[]) => {
      for (const key of keys) {
        lists.delete(key);
        sets.delete(key);
      }
      return Promise.resolve(keys.length);
    }),
    multi: vi.fn(multi),
  };
  const cipher = new RuntimeCipher(new Keyring(`test:${Buffer.alloc(32, 7).toString('base64')}`));
  const store = new TranscriptStore({ client } as unknown as RedisService, cipher);
  return { store, client, lists, ttl };
}

describe('TranscriptStore', () => {
  it('seals lines per tenant and interaction and reads them back in order', async () => {
    const { store, lists, ttl } = harness();
    expect(await store.append(TENANT, CALL, line('s1'))).toEqual({ stored: true, first: true });
    expect(await store.append(TENANT, CALL, line('s2', 'Fatura'))).toEqual({
      stored: true,
      first: false,
    });
    const raw = [...lists.values()].flat().join('');
    expect(raw).not.toContain('iptal');
    expect(raw).not.toContain('Fatura');
    expect((await store.read(TENANT, CALL)).map((l) => l.segmentId)).toEqual(['s1', 's2']);
    expect([...ttl.values()]).toEqual([TRANSCRIPT_TTL_SECONDS, TRANSCRIPT_TTL_SECONDS]);
    expect(await store.read(OTHER_TENANT, CALL)).toEqual([]);
  });

  it('stores a re-delivered segment once', async () => {
    const { store } = harness();
    await store.append(TENANT, CALL, line('s1'));
    expect(await store.append(TENANT, CALL, line('s1'))).toEqual({ stored: false, first: false });
    expect(await store.read(TENANT, CALL)).toHaveLength(1);
  });

  it('keeps only the newest window of lines', async () => {
    const { store } = harness();
    for (let i = 0; i < TRANSCRIPT_WINDOW + 3; i += 1)
      await store.append(TENANT, CALL, line(`s${String(i)}`));
    const lines = await store.read(TENANT, CALL);
    expect(lines).toHaveLength(TRANSCRIPT_WINDOW);
    expect(lines[0]?.segmentId).toBe('s3');
  });

  it('skips lines sealed for another scope and clears an interaction', async () => {
    const { store, lists } = harness();
    await store.append(TENANT, CALL, line('s1'));
    const [key] = [...lists.keys()];
    lists.set(key ?? '', [...(lists.get(key ?? '') ?? []), 'not-a-sealed-value']);
    expect(await store.read(TENANT, CALL)).toHaveLength(1);
    await store.clear(TENANT, CALL);
    expect(await store.read(TENANT, CALL)).toEqual([]);
  });

  it('degrades to "not stored" when Redis is unavailable', async () => {
    const { store, client } = harness();
    client.sismember.mockRejectedValueOnce(new Error('down'));
    expect(await store.append(TENANT, CALL, line('s1'))).toEqual({ stored: false, first: false });
    client.lrange.mockRejectedValueOnce(new Error('down'));
    expect(await store.read(TENANT, CALL)).toEqual([]);
    client.del.mockRejectedValueOnce(new Error('down'));
    await expect(store.clear(TENANT, CALL)).resolves.toBeUndefined();
  });
});
