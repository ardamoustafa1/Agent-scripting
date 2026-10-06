import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, inject, it } from 'vitest';

import { RedisService } from '../../src/infra/redis/redis.service.js';
import { RedisEngageLinkStore } from '../../src/modules/connectors/genesys-engage/engage-agent-link.service.js';
import { Keyring } from '../../src/modules/identity/crypto/keyring.js';
import { sha256Hex } from '../../src/modules/identity/crypto/random.js';

import type { ApiEnv } from '../../src/env.js';
import type {
  EngageLink,
  EngageLinkState,
} from '../../src/modules/connectors/genesys-engage/engage-agent-link.js';

let redis: RedisService, store: RedisEngageLinkStore;
const keys = new Keyring(`synthetic:${Buffer.alloc(32, 11).toString('base64')}`);
beforeAll(async () => {
  redis = new RedisService({ REDIS_URL: inject('redisUrl') } as ApiEnv);
  await redis.ping();
  store = new RedisEngageLinkStore(redis, keys);
});
afterAll(async () => {
  await redis.onModuleDestroy();
});

const state = (): EngageLinkState => ({
  tenantId: randomUUID(),
  userId: randomUUID(),
  sessionId: 'synthetic-browser',
  connectorId: randomUUID(),
  createdAt: Date.now(),
});
const link = (): EngageLink => ({
  userId: randomUUID(),
  platformUserId: 'synthetic-platform-user',
  refreshToken: 'synthetic-refresh-secret',
  accessToken: 'synthetic-access-secret',
  accessExpiresAt: Date.now() + 60000,
  linkedAt: new Date().toISOString(),
  expiresAt: Date.now() + 120000,
});

it('seals browser state in real Redis with TTL and atomically consumes it only once', async () => {
  const handle = randomUUID(),
    value = state();
  await store.putState(handle, value, 300);
  const key = `ge:state:${sha256Hex(handle)}`;
  expect(await redis.client.ttl(key)).toBeGreaterThan(0);
  const sealed = await redis.client.get(key);
  expect(sealed).not.toContain(value.sessionId);
  expect(sealed).not.toContain(value.userId);
  const results = await Promise.all([
    store.takeState(handle),
    store.takeState(handle),
    store.takeState(handle),
  ]);
  expect(results.filter((result) => result !== undefined)).toEqual([value]);
});

it.each(['ciphertext', 'schema', 'scope'] as const)(
  'refuses unsafe sealed state: %s',
  async (reason) => {
    const handle = randomUUID(),
      key = `ge:state:${sha256Hex(handle)}`;
    const sealed =
      reason === 'ciphertext'
        ? 'corrupted'
        : keys.seal(
            JSON.stringify(reason === 'schema' ? {} : state()),
            reason === 'scope' ? 'different-record' : key,
          );
    await redis.client.set(key, sealed, 'EX', 30);
    expect(await store.takeState(handle)).toBeUndefined();
    expect(await redis.client.exists(key)).toBe(0);
  },
);

it('isolates encrypted delegated tokens by tenant/connector and removes stale index entries', async () => {
  const tenantId = randomUUID(),
    connectorId = randomUUID(),
    value = link();
  await store.putLink(tenantId, connectorId, value);
  const key = `ge:link:${tenantId}:${connectorId}:${sha256Hex(value.platformUserId)}`;
  const sealed = await redis.client.get(key);
  expect(sealed).not.toContain(value.refreshToken);
  expect(sealed).not.toContain(value.accessToken);
  expect(await redis.client.ttl(key)).toBeGreaterThan(0);
  expect(await store.getLink(tenantId, connectorId, value.platformUserId)).toEqual(value);
  expect(await store.getLink(randomUUID(), connectorId, value.platformUserId)).toBeUndefined();
  expect(await store.listLinks(tenantId, connectorId)).toEqual([value.platformUserId]);
  await redis.client.del(key);
  expect(await store.listLinks(tenantId, connectorId)).toEqual([]);
  expect(await redis.client.scard(`ge:links:${tenantId}:${connectorId}`)).toBe(0);
});

it('deletes the delegated token and index together, and prevents cross-record ciphertext reuse', async () => {
  const tenantId = randomUUID(),
    connectorId = randomUUID(),
    value = link();
  await store.putLink(tenantId, connectorId, value);
  const key = `ge:link:${tenantId}:${connectorId}:${sha256Hex(value.platformUserId)}`;
  const sealed = (await redis.client.get(key))!;
  const other = `ge:link:${tenantId}:${connectorId}:${sha256Hex('other-user')}`;
  await redis.client.set(other, sealed, 'EX', 30);
  expect(await store.getLink(tenantId, connectorId, 'other-user')).toBeUndefined();
  await store.deleteLink(tenantId, connectorId, value.platformUserId);
  expect(await store.getLink(tenantId, connectorId, value.platformUserId)).toBeUndefined();
  expect(await store.listLinks(tenantId, connectorId)).toEqual([]);
});
