import { createHash, randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, inject, it, vi } from 'vitest';

import { Keyring } from '../../src/modules/identity/crypto/keyring.js';
import { sha256Hex } from '../../src/modules/identity/crypto/random.js';
import { SessionStore } from '../../src/modules/identity/session/session-store.js';
import { LaunchRealtime } from '../../src/modules/launch/launch-realtime.js';
import { RuntimeRealtimeService } from '../../src/modules/runtime/runtime-realtime.service.js';

import type { TenantDb } from '../../src/infra/database/tenant-db.js';
import type { RedisService } from '../../src/infra/redis/redis.service.js';
import type { AbilityFactory } from '../../src/modules/authz/ability.factory.js';
import type { NewSession } from '../../src/modules/identity/session/session.types.js';
import type { RuntimeEngineService } from '../../src/modules/runtime/runtime-engine.service.js';
import type { FastifyRequest } from 'fastify';

let redis: Redis;
const keys = new Keyring(`synthetic:${Buffer.alloc(32, 12).toString('base64')}`);
beforeAll(async () => {
  redis = new Redis(inject('redisUrl'), { keyPrefix: `session-verification:${randomUUID()}:` });
  await redis.ping();
});
afterAll(() => {
  redis.disconnect();
});
const policy = {
  idleTimeoutSeconds: 120,
  absoluteTimeoutSeconds: 600,
  maxConcurrent: 10,
  onLimit: 'deny' as const,
};
function fixture() {
  let now = Date.now();
  const input: NewSession = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    kind: 'sso',
    protocol: 'saml',
    idpId: randomUUID(),
    app: 'admin',
    ip: '127.0.0.1',
    userAgent: 'synthetic',
    saml: { nameId: 'synthetic-name', nameIdFormat: 'synthetic-format', sessionIndex: 'first' },
  };
  return {
    input,
    store: new SessionStore(redis, keys, () => now),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

it('validates websocket hashes and refuses idle or absolutely expired records without touching them', async () => {
  const f = fixture();
  const session = await f.store.create(f.input, policy);
  const hash = SessionStore.hashToken(session.token);
  expect(await f.store.loadHash('invalid-hash')).toBeUndefined();
  expect((await f.store.loadHash(hash))?.id).toBe(session.record.id);
  f.advance(120000);
  expect(await f.store.loadHash(hash)).toBeUndefined();
  expect(await f.store.load(session.token)).toBeUndefined();
  const absolute = await f.store.create(f.input, { ...policy, idleTimeoutSeconds: 900 });
  f.advance(600000);
  expect(await f.store.loadHash(SessionStore.hashToken(absolute.token))).toBeUndefined();
  expect(await f.store.loadHash('f'.repeat(64))).toBeUndefined();
});
it('does not resurrect revoked sessions during token refresh, but updates live records', async () => {
  const f = fixture();
  const session = await f.store.create(f.input, policy);
  const hash = SessionStore.hashToken(session.token);
  await f.store.update(hash, { ...session.record, app: 'designer' });
  expect((await f.store.load(session.token))?.record.app).toBe('designer');
  await f.store.revokeHash(hash);
  await f.store.update(hash, session.record);
  expect(await f.store.load(session.token)).toBeUndefined();
});
it('revokes by public id and preserves an explicitly exempted session', async () => {
  const f = fixture();
  const a = await f.store.create(f.input, policy),
    b = await f.store.create(f.input, policy),
    c = await f.store.create(f.input, policy);
  expect(await f.store.revokeById(f.input.tenantId, f.input.userId, randomUUID())).toBeUndefined();
  expect(await f.store.revokeById(randomUUID(), f.input.userId, a.record.id)).toBeUndefined();
  expect((await f.store.revokeById(f.input.tenantId, f.input.userId, a.record.id))?.id).toBe(
    a.record.id,
  );
  expect(
    (
      await f.store.revokeAllForUser(f.input.tenantId, f.input.userId, { exceptId: b.record.id })
    ).map((row) => row.id),
  ).toEqual([c.record.id]);
  expect(await f.store.load(b.token)).toBeDefined();
});
it('narrows SAML logout to the requested session indexes, including sessions without an index', async () => {
  const f = fixture();
  const a = await f.store.create(f.input, policy);
  const b = await f.store.create(
    { ...f.input, saml: { ...f.input.saml!, sessionIndex: 'second' } },
    policy,
  );
  const c = await f.store.create(
    { ...f.input, saml: { nameId: 'synthetic-name', nameIdFormat: 'synthetic-format' } },
    policy,
  );
  expect(
    (await f.store.revokeBySaml(f.input.tenantId, f.input.idpId!, 'synthetic-name', ['first'])).map(
      (row) => row.id,
    ),
  ).toEqual([a.record.id]);
  expect(await f.store.load(b.token)).toBeDefined();
  expect(await f.store.load(c.token)).toBeDefined();
  expect(
    new Set(
      (await f.store.revokeBySaml(f.input.tenantId, f.input.idpId!, 'synthetic-name', [])).map(
        (row) => row.id,
      ),
    ),
  ).toEqual(new Set([b.record.id, c.record.id]));
});
it('prunes stale SAML index entries and ignores mismatched tenant and NameID records', async () => {
  const f = fixture();
  const a = await f.store.create(f.input, policy);
  const hash = SessionStore.hashToken(a.token);
  const setKey = `idn:saml:${f.input.tenantId}:${f.input.idpId!}:${sha256Hex('synthetic-name')}`;
  await redis.sadd(setKey, 'e'.repeat(64));
  const foreign = await f.store.create({ ...f.input, tenantId: randomUUID() }, policy),
    otherName = await f.store.create(
      { ...f.input, saml: { nameId: 'other', nameIdFormat: 'synthetic-format' } },
      policy,
    );
  await redis.sadd(
    setKey,
    SessionStore.hashToken(foreign.token),
    SessionStore.hashToken(otherName.token),
  );
  expect(
    (await f.store.revokeBySaml(f.input.tenantId, f.input.idpId!, 'synthetic-name', [])).map(
      (row) => row.id,
    ),
  ).toEqual([a.record.id]);
  expect(await redis.sismember(setKey, 'e'.repeat(64))).toBe(0);
  expect(await redis.exists(`idn:sess:${hash}`)).toBe(0);
  expect(await f.store.load(foreign.token)).toBeDefined();
  expect(await f.store.load(otherName.token)).toBeDefined();
});
it('revokes OIDC subject sessions without sid and safely tolerates stale indexes', async () => {
  const f = fixture();
  const session = await f.store.create(
    { ...f.input, protocol: 'oidc', saml: undefined, oidc: { sub: 'synthetic-sub' } },
    policy,
  );
  const setKey = `idn:sub:${f.input.tenantId}:${f.input.idpId!}:${sha256Hex('synthetic-sub')}`;
  await redis.sadd(setKey, 'e'.repeat(64));
  expect(
    (await f.store.revokeByOidcSubject(f.input.tenantId, f.input.idpId!, 'synthetic-sub')).map(
      (row) => row.id,
    ),
  ).toEqual([session.record.id]);
  expect(await redis.exists(setKey)).toBe(0);
});
it('supports local break-glass sessions without creating IdP indexes', async () => {
  const f = fixture();
  const { idpId: _idpId, saml: _saml, ...base } = f.input;
  const session = await f.store.create({ ...base, kind: 'break_glass', protocol: 'local' }, policy);
  expect(await f.store.load(session.token)).toBeDefined();
  expect(
    (await f.store.revokeAllForUser(f.input.tenantId, f.input.userId)).map((row) => row.id),
  ).toEqual([session.record.id]);
});
it.each(['tampered', 'invalid JSON', 'invalid schema', 'wrong key'] as const)(
  'fails closed for a %s sealed session',
  async (reason) => {
    const f = fixture();
    const session = await f.store.create(f.input, policy);
    const key = `idn:sess:${SessionStore.hashToken(session.token)}`;
    const value =
      reason === 'tampered'
        ? 'broken ciphertext'
        : keys.seal(
            reason === 'invalid JSON'
              ? '{'
              : reason === 'invalid schema'
                ? JSON.stringify({ v: 100 })
                : JSON.stringify(session.record),
            reason === 'wrong key' ? 'different-record' : key,
          );
    await redis.set(key, value);
    expect(await f.store.load(session.token)).toBeUndefined();
    expect(await f.store.listForUser(f.input.tenantId, f.input.userId)).toEqual([]);
  },
);
it('does not delete a replacement refresh lock after the original owner expires', async () => {
  const f = fixture();
  const name = `synthetic-refresh:${randomUUID()}`;
  const release = await f.store.tryLock(name);
  expect(release).toBeDefined();
  await redis.set(`idn:lock:${name}`, 'replacement-owner');
  await release?.();
  expect(await redis.get(`idn:lock:${name}`)).toBe('replacement-owner');
});

async function launchFixture() {
  const f = fixture();
  const session = await f.store.create(f.input, policy);
  const service = new LaunchRealtime({ client: redis } as unknown as RedisService, keys, f.store);
  const request = {
    headers: { origin: 'https://synthetic-designer.test' },
    verbisSession: { hash: SessionStore.hashToken(session.token), record: session.record },
  } as unknown as FastifyRequest;
  return { ...f, service, request, session };
}
it('issues encrypted origin-bound realtime tickets and atomically consumes them once', async () => {
  const f = await launchFixture();
  const issued = await f.service.issue(f.request);
  expect(issued).toMatchObject({ expiresIn: 30, namespace: '/launch' });
  const results = await Promise.allSettled([
    f.service.consume(issued.ticket, f.request.headers.origin),
    f.service.consume(issued.ticket, f.request.headers.origin),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const valid = results.find((result) => result.status === 'fulfilled');
  if (valid?.status !== 'fulfilled') throw new Error('No valid ticket');
  expect(valid.value).toMatchObject({
    tenantId: f.input.tenantId,
    userId: f.input.userId,
    bffId: f.session.record.id,
  });
});
it.each(['missing session', 'missing origin', 'array origin'] as const)(
  'refuses realtime issue with %s',
  async (reason) => {
    const f = await launchFixture();
    const request = {
      ...f.request,
      ...(reason === 'missing session'
        ? { verbisSession: undefined }
        : {
            headers: { origin: reason === 'array origin' ? ['https://synthetic.test'] : undefined },
          }),
    } as unknown as FastifyRequest;
    await expect(f.service.issue(request)).rejects.toThrow('authenticated browser');
  },
);
it.each([
  'invalid ticket type',
  'malformed ticket',
  'missing origin',
  'unknown ticket',
  'wrong origin',
  'expired ticket',
  'revoked browser',
  'wrong browser id',
  'wrong user',
  'wrong tenant',
] as const)('rejects unsafe realtime consumption: %s', async (reason) => {
  const f = await launchFixture();
  const issued = await f.service.issue(f.request);
  let ticket: unknown = issued.ticket,
    origin: unknown = f.request.headers.origin;
  if (reason === 'invalid ticket type') ticket = null;
  if (reason === 'malformed ticket') ticket = 'invalid';
  if (reason === 'missing origin') origin = undefined;
  if (reason === 'unknown ticket') ticket = 'a'.repeat(43);
  if (reason === 'wrong origin') origin = 'https://foreign.test';
  if (reason === 'revoked browser')
    await f.store.revokeHash(SessionStore.hashToken(f.session.token));
  if (['expired ticket', 'wrong browser id', 'wrong user', 'wrong tenant'].includes(reason)) {
    const key = `launch:ticket:${createHash('sha256').update(issued.ticket).digest('hex')}`;
    const sealed = await redis.get(key);
    if (!sealed) throw new Error('No sealed grant');
    const grant = JSON.parse(keys.openString(sealed, key)) as Record<string, unknown>;
    if (reason === 'expired ticket') grant['expiresAt'] = Date.now() - 1;
    if (reason === 'wrong browser id') grant['bffId'] = randomUUID();
    if (reason === 'wrong user') grant['userId'] = randomUUID();
    if (reason === 'wrong tenant') grant['tenantId'] = randomUUID();
    await redis.set(key, keys.seal(JSON.stringify(grant), key));
  }
  await expect(f.service.consume(ticket, origin)).rejects.toThrow();
});

async function runtimeTicketFixture() {
  const f = await launchFixture(),
    sessionId = randomUUID();
  const tx = {
    tenant: { findUniqueOrThrow: vi.fn().mockResolvedValue({ status: 'active', settings: {} }) },
    sessionEvent: { findMany: vi.fn().mockResolvedValue([{ seq: 1 }, { seq: 2 }, { seq: 3 }]) },
  };
  const abilities = { forPrincipal: vi.fn().mockResolvedValue({ ability: {} }) };
  const engine = {
    row: vi.fn().mockResolvedValue({ tenantId: f.input.tenantId }),
    authorize: vi.fn(),
    view: vi.fn().mockResolvedValue({ sequence: 3, id: sessionId }),
  };
  const service = new RuntimeRealtimeService(
    { client: redis } as unknown as RedisService,
    keys,
    f.store,
    {
      current: () => tx,
      run: (_tenant: string, work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as TenantDb,
    abilities as unknown as AbilityFactory,
    engine as unknown as RuntimeEngineService,
  );
  return { ...f, sessionId, tx, abilities, engine, service };
}
it('issues supervisor runtime tickets and resumes only complete event sequences', async () => {
  const f = await runtimeTicketFixture();
  const issued = await f.service.issue(f.sessionId, 0, f.request, true);
  const grant = await f.service.consume(issued.ticket, f.request.headers.origin);
  expect(grant).toMatchObject({ supervisor: true, sessionId: f.sessionId, afterSequence: 0 });
  expect(await f.service.resume(grant)).toMatchObject({
    reset: false,
    sequence: 3,
    events: [{ seq: 1 }, { seq: 2 }, { seq: 3 }],
  });
  expect(f.engine.view).toHaveBeenCalledWith(f.sessionId, true);
  f.tx.sessionEvent.findMany.mockResolvedValue([{ seq: 1 }, { seq: 3 }]);
  expect(await f.service.resume(grant)).toMatchObject({ reset: true, events: [] });
  f.tx.sessionEvent.findMany.mockResolvedValue([{ seq: 1 }, { seq: 1 }, { seq: 3 }]);
  expect(await f.service.resume(grant)).toMatchObject({ reset: true, events: [] });
  await expect(f.service.consume(issued.ticket, f.request.headers.origin)).rejects.toThrow();
});
it.each([
  'missing browser',
  'missing origin',
  'inactive tenant',
  'revoked ability',
  'wrong bound origin',
  'wrong browser id',
  'wrong user',
  'wrong tenant',
  'expired',
  'wrong origin',
  'malformed ticket',
  'invalid ticket type',
  'invalid origin type',
] as const)('rejects unsafe runtime tickets: %s', async (reason) => {
  const f = await runtimeTicketFixture();
  if (reason === 'missing browser' || reason === 'missing origin') {
    const request = {
      ...f.request,
      ...(reason === 'missing browser' ? { verbisSession: undefined } : { headers: {} }),
    } as unknown as FastifyRequest;
    await expect(f.service.issue(f.sessionId, 0, request)).rejects.toThrow();
    return;
  }
  const issued = await f.service.issue(f.sessionId, 0, f.request);
  let ticket: unknown = issued.ticket,
    origin: unknown = f.request.headers.origin;
  if (reason === 'inactive tenant')
    f.tx.tenant.findUniqueOrThrow.mockResolvedValue({ status: 'disabled', settings: {} });
  if (reason === 'revoked ability') f.abilities.forPrincipal.mockResolvedValue(undefined);
  if (reason === 'wrong bound origin')
    await f.store.update(SessionStore.hashToken(f.session.token), {
      ...f.session.record,
      boundOrigin: 'https://other.test',
    });
  if (reason === 'wrong origin') origin = 'https://other.test';
  if (reason === 'malformed ticket') ticket = 'invalid';
  if (reason === 'invalid ticket type') ticket = null;
  if (reason === 'invalid origin type') origin = null;
  if (['wrong browser id', 'wrong user', 'wrong tenant', 'expired'].includes(reason)) {
    const key = `runtime:ticket:${sha256Hex(issued.ticket)}`,
      sealed = await redis.get(key);
    if (!sealed) throw new Error('No runtime grant');
    const grant = JSON.parse(keys.openString(sealed, key)) as Record<string, unknown>;
    if (reason === 'wrong browser id') grant['bffId'] = randomUUID();
    if (reason === 'wrong user') grant['userId'] = randomUUID();
    if (reason === 'wrong tenant') grant['tenantId'] = randomUUID();
    if (reason === 'expired') grant['expiresAt'] = Date.now() - 1;
    await redis.set(key, keys.seal(JSON.stringify(grant), key));
  }
  await expect(f.service.consume(ticket, origin)).rejects.toThrow();
});
