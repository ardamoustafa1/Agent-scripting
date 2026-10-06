import { describe, expect, it, vi } from 'vitest';

import { Keyring } from '../identity/crypto/keyring.js';

import { emptySnapshot } from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimeStateStore } from './runtime-state.store.js';

import type { RedisService } from '../../infra/redis/redis.service.js';

describe('sealed hot state and durable recovery', () => {
  function harness() {
    const values = new Map<string, string>();
    const redis = {
      client: {
        get: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
        set: vi.fn((key: string, value: string) => {
          values.set(key, value);
          return Promise.resolve('OK');
        }),
      },
    };
    const store = new RuntimeStateStore(
      redis as unknown as RedisService,
      new RuntimeCipher(new Keyring(`test:${Buffer.alloc(32, 2).toString('base64')}`)),
    );
    return { values, redis, store };
  }
  it('invalidates cached and secure values after an administrative version change without altering the event sequence', async () => {
    const { store } = harness();
    await store.write(
      'tenant',
      'session',
      2,
      { ...emptySnapshot(), variables: { customer: 'fixture', card: 'tok_fixture' } },
      ['card'],
      5,
    );
    expect((await store.read('tenant', 'session', 2, {}, 6)).variables).toEqual({});
  });
  it('binds ciphertext to tenant and session and recovers from Redis loss', async () => {
    const { store, redis, values } = harness(),
      snapshot = { ...emptySnapshot(), variables: { customer: 'Synthetic customer' } };
    const persisted = store.seal('tenant', 'session', snapshot);
    expect(JSON.stringify(persisted)).not.toContain('Synthetic customer');
    expect(() => store.open('other-tenant', 'session', persisted)).toThrow();
    expect(() => store.open('tenant', 'other-session', persisted)).toThrow();
    await store.write('tenant', 'session', 2, snapshot);
    expect([...values.values()].join('')).not.toContain('Synthetic customer');
    expect(await store.read('tenant', 'session', 2, persisted)).toEqual(snapshot);
    redis.client.get.mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await store.read('tenant', 'session', 2, persisted)).toEqual(snapshot);
  });
  it('ignores an uncommitted or stale sequence cache entry', async () => {
    const { store } = harness(),
      durable = emptySnapshot();
    await store.write('tenant', 'session', 3, { ...durable, variables: { counter: 8 } });
    expect(
      await store.read('tenant', 'session', 2, store.seal('tenant', 'session', durable)),
    ).toEqual(durable);
  });
  it('keeps secure tokens only in local memory and removes them from Redis', async () => {
    const { store, values } = harness(),
      token = 'tok_abcdefghijklmnop';
    await store.write('tenant', 'session', 2, { ...emptySnapshot(), variables: { card: token } }, [
      'card',
    ]);
    const durable = store.seal('tenant', 'session', emptySnapshot());
    expect((await store.read('tenant', 'session', 2, durable)).variables['card']).toBe(token);
    const envelope = values.get(store.slot('tenant', 'session'));
    expect(envelope).toBeDefined();
    // A fresh instance has no secure memory, even when it can decrypt the shared Redis entry.
    const keys = new RuntimeCipher(new Keyring(`test:${Buffer.alloc(32, 2).toString('base64')}`));
    const decoded = JSON.parse(
      keys.openString(envelope ?? '', store.slot('tenant', 'session')),
    ) as { snapshot: { variables: Record<string, unknown> } };
    expect(decoded.snapshot.variables['card']).toBeUndefined();
    await store.write('tenant', 'session', 3, emptySnapshot(), ['card']);
    expect((await store.read('tenant', 'session', 3, durable)).variables['card']).toBeUndefined();
  });
});
