import { randomUUID } from 'node:crypto';

import { Document, Server } from '@hocuspocus/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeDocument, readDocument, Y } from '@verbis/collaboration';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { requestContext, systemContext } from '../../common/context/request-context.js';

import { CollaborationService } from './collaboration.service.js';

import type { DraftLeaseService } from './draft-lease.service.js';
import type { ScriptsService } from './scripts.service.js';
import type { TeamService } from './team.service.js';
import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AbilityFactory } from '../authz/ability.factory.js';
import type { LaunchGrant, LaunchRealtime } from '../launch/launch-realtime.js';
import type { FastifyRequest } from 'fastify';

type Grant = LaunchGrant & { scriptId: string; number: number; documentName: string };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(enabled = true, failListen = false) {
  vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
    return failListen
      ? Promise.reject(new Error('private bind details'))
      : Promise.resolve(this.hocuspocus);
  });
  const grant: Grant = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    bffId: randomUUID(),
    bffHash: 'a'.repeat(64),
    origin: 'https://designer.example.test',
    expiresAt: Date.now() + 60000,
    scriptId: randomUUID(),
    number: 1,
    documentName: '',
  };
  grant.documentName = `${grant.tenantId}:${grant.scriptId}:1`;
  const version = {
    id: randomUUID(),
    state: 'draft',
    version: 4,
    document: minimalScript(),
    screens: [],
  };
  const tx = {
    tenant: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
    collaborationSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    scriptVersion: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ source: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    getdel: vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ tenantId: grant.tenantId, scriptId: grant.scriptId, number: 1 }),
      ),
  };
  const tickets = {
    issue: vi.fn().mockResolvedValue({ ticket: 'synthetic-ticket' }),
    consume: vi.fn().mockResolvedValue(grant),
    validate: vi.fn().mockResolvedValue(undefined),
  };
  const authorize = vi.fn().mockResolvedValue(version);
  const abilities = { forPrincipal: vi.fn().mockResolvedValue({ ability: {} }) };
  const scripts = {
    getVersion: vi.fn().mockResolvedValue(version),
    composeForCollaboration: vi
      .fn()
      .mockImplementation((_tx: unknown, input: { document: unknown }) =>
        Promise.resolve(input.document),
      ),
    updateDraft: vi.fn().mockResolvedValue({ version: 5, checksum: 'synthetic' }),
  };
  const leases = {
    claim: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    key: vi.fn().mockReturnValue('synthetic-lease'),
  };
  const service = new CollaborationService(
    { COLLABORATION_PORT: enabled ? 12345 : 0, COLLABORATION_ADDRESS: '127.0.0.1' } as ApiEnv,
    {
      run: (_tenant: string, work: (value: typeof tx) => Promise<unknown>) => work(tx),
      current: () => tx,
      tenantId: () => grant.tenantId,
    } as unknown as TenantDb,
    { client: redis } as unknown as RedisService,
    tickets as unknown as LaunchRealtime,
    abilities as unknown as AbilityFactory,
    { authorize } as unknown as TeamService,
    scripts as unknown as ScriptsService,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    leases as unknown as DraftLeaseService,
  );
  service.onApplicationBootstrap();
  const server = (service as unknown as { server: Server<Grant> }).server;
  const document = new Document(grant.documentName);
  cleanups.push(async () => {
    await service.onModuleDestroy();
    document.destroy();
  });
  async function hook(name: keyof Server<Grant>['configuration'], payload: unknown) {
    const callback = Reflect.get(server.configuration, name) as unknown as (
      input: unknown,
    ) => Promise<unknown>;
    return callback(payload);
  }
  const payload = {
    context: grant,
    documentName: grant.documentName,
    document,
    socketId: 'socket-a',
  };
  const load = () => hook('onLoadDocument', payload);
  const auth = () =>
    hook('onAuthenticate', {
      ...payload,
      token: 'synthetic-ticket',
      requestHeaders: new Headers({ origin: grant.origin }),
    });
  return {
    service,
    server,
    grant,
    version,
    tx,
    redis,
    tickets,
    authorize,
    abilities,
    scripts,
    leases,
    document,
    hook,
    payload,
    load,
    auth,
  };
}

describe('collaboration authenticated document lifecycle', () => {
  it('issues a short-lived tenant and draft binding with trusted author identity', async () => {
    const f = fixture();
    const result = await requestContext.run(
      {
        ...systemContext(randomUUID(), 'test'),
        principal: { type: 'user', id: f.grant.userId, tenantId: f.grant.tenantId, scopes: [] },
      },
      () => f.service.issue({} as FastifyRequest, f.grant.scriptId, 1),
    );
    expect(result).toMatchObject({
      documentName: f.grant.documentName,
      userId: f.grant.userId,
      path: '/collaboration',
    });
    expect(f.redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^collaboration:ticket:[a-f0-9]{64}$/),
      JSON.stringify({ scriptId: f.grant.scriptId, number: 1, tenantId: f.grant.tenantId }),
      'EX',
      30,
    );
    expect(await f.auth()).toMatchObject(f.grant);
    expect(f.tickets.consume).toHaveBeenCalledWith('synthetic-ticket', f.grant.origin);
  });
  it('rejects issue while disabled and for immutable published versions', async () => {
    const disabled = fixture(false);
    await expect(
      disabled.service.issue({} as FastifyRequest, disabled.grant.scriptId, 1),
    ).rejects.toMatchObject({ code: 'VERBIS_VALIDATION_FAILED' });
    const f = fixture();
    f.version.state = 'published';
    await expect(f.service.issue({} as FastifyRequest, f.grant.scriptId, 1)).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_VERSION_IMMUTABLE',
    });
    expect(f.tickets.issue).not.toHaveBeenCalled();
  });
  it.each([
    'missing binding',
    'wrong tenant',
    'wrong room',
    'published',
    'inactive tenant',
    'no permissions',
  ] as const)('rejects authentication with %s', async (reason) => {
    const f = fixture();
    if (reason === 'missing binding') f.redis.getdel.mockResolvedValue(null);
    if (reason === 'wrong tenant')
      f.redis.getdel.mockResolvedValue(
        JSON.stringify({ tenantId: randomUUID(), scriptId: f.grant.scriptId, number: 1 }),
      );
    if (reason === 'wrong room') f.payload.documentName = 'another-room';
    if (reason === 'published') f.version.state = 'published';
    if (reason === 'inactive tenant') f.tx.tenant.findFirst.mockResolvedValue(null);
    if (reason === 'no permissions') f.abilities.forPrincipal.mockResolvedValue(undefined);
    await expect(f.auth()).rejects.toThrow();
    expect(f.leases.claim).not.toHaveBeenCalled();
  });
  it('rejects capacity overflow before consuming a ticket', async () => {
    const f = fixture();
    vi.spyOn(f.server.hocuspocus, 'getConnectionsCount').mockReturnValue(500);
    await expect(f.auth()).rejects.toThrow('capacity');
    expect(f.tickets.consume).not.toHaveBeenCalled();
  });
  it.each(['absent', 'stale', 'current'] as const)(
    'loads a %s persisted CRDT snapshot safely',
    async (snapshot) => {
      const f = fixture();
      const prior = new Y.Doc();
      initializeDocument(prior, minimalScript());
      prior.getMap('metadata').set('synthetic-marker', 'preserved');
      if (snapshot !== 'absent')
        f.tx.collaborationSnapshot.findFirst.mockResolvedValue({
          version: snapshot === 'current' ? 4 : 3,
          state: Y.encodeStateAsUpdate(prior),
        });
      await f.load();
      expect(readDocument(f.document)).toEqual(minimalScript());
      expect(f.document.getMap('metadata').get('synthetic-marker')).toBe(
        snapshot === 'current' ? 'preserved' : undefined,
      );
      expect(f.leases.claim).toHaveBeenCalledOnce();
      prior.destroy();
    },
  );
  it('releases the lease if loading fails, and blocks further writes', async () => {
    const f = fixture();
    f.scripts.getVersion.mockRejectedValue(new Error('storage unavailable'));
    await expect(f.load()).rejects.toThrow('storage unavailable');
    expect(f.leases.release).toHaveBeenCalledWith('synthetic-lease', expect.any(String));
    await expect(f.hook('beforeHandleMessage', f.payload)).rejects.toThrow();
  });
  it('checks newly published drafts at persistence before accepting a save', async () => {
    const f = fixture();
    await f.load();
    await f.hook('beforeHandleMessage', f.payload);
    expect(f.tickets.validate).toHaveBeenCalledTimes(1);
    f.version.state = 'published';
    await expect(f.service.persist(f.grant.documentName, f.document)).rejects.toThrow();
  });
  it('validates an actual Yjs update without mutating the live document', async () => {
    const f = fixture();
    await f.load();
    await f.hook('beforeSync', { ...f.payload, type: 0, payload: new Uint8Array() });
    expect(f.scripts.composeForCollaboration).not.toHaveBeenCalled();
    await f.hook('beforeSync', {
      ...f.payload,
      type: 2,
      payload: Y.encodeStateAsUpdate(f.document),
    });
    expect(readDocument(f.document)).toEqual(minimalScript());
    const composed = structuredClone(minimalScript());
    composed.meta.name = 'Changed linked content';
    f.scripts.composeForCollaboration.mockResolvedValue(composed);
    await expect(f.service.persist(f.grant.documentName, f.document)).rejects.toThrow(
      'Linked content',
    );
  });
  it('flushes and snapshots before releasing the lease, and survives repeated closure', async () => {
    const f = fixture();
    await f.load();
    const close = vi.spyOn(f.server.hocuspocus, 'closeConnections');
    await expect(f.service.flush(f.grant.scriptId, 1)).resolves.toEqual({ closed: true });
    expect(f.tx.collaborationSnapshot.upsert).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(f.grant.documentName);
    expect(f.leases.release).toHaveBeenCalledOnce();
    await expect(f.service.flush(f.grant.scriptId, 1)).resolves.toEqual({ closed: true });
    expect(f.tx.collaborationSnapshot.upsert).toHaveBeenCalledOnce();
  });
  it('finishes shutdown when a flushed room leaves an idle SDK document in memory', async () => {
    const f = fixture();
    await f.load();
    f.document.isLoading = false;
    f.server.hocuspocus.documents.set(f.grant.documentName, f.document);
    await f.service.flush(f.grant.scriptId, 1);
    const stopping = f.service.onModuleDestroy();
    const finished = await Promise.race([
      stopping.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => {
          resolve(false);
        }, 50),
      ),
    ]);
    // Clean up a failing regression without leaving the test worker blocked.
    if (!finished) {
      await f.server.hocuspocus.unloadDocument(f.document);
      await stopping;
    }
    expect(finished).toBe(true);
    expect(f.server.hocuspocus.getDocumentsCount()).toBe(0);
  });
  it('unfreezes a failed flush so valid corrections can still be submitted', async () => {
    const f = fixture();
    await f.load();
    f.scripts.updateDraft.mockRejectedValue(new Error('transaction aborted'));
    await expect(f.service.flush(f.grant.scriptId, 1)).rejects.toThrow('transaction aborted');
    await expect(f.hook('beforeHandleMessage', f.payload)).resolves.toBeUndefined();
    expect(f.leases.release).not.toHaveBeenCalled();
  });
});

describe('collaboration presence ownership', () => {
  const state = {
    pageId: 'page-a',
    selection: ['node-a'],
    cursor: { x: 0.5, y: 0.2 },
    userId: 'forged-author',
  };
  it('uses the authenticated author and prevents awareness identity takeover', async () => {
    const f = fixture();
    await f.load();
    const states = new Map([[1, state]]);
    await f.hook('beforeHandleAwareness', { ...f.payload, states });
    expect(states.get(1)).toMatchObject({ userId: f.grant.userId });
    await expect(
      f.hook('beforeHandleAwareness', { ...f.payload, socketId: 'attacker', states }),
    ).rejects.toThrow();
    await expect(
      f.hook('beforeHandleAwareness', { ...f.payload, states: new Map([[2, state]]) }),
    ).rejects.toThrow();
    await f.hook('onDisconnect', f.payload);
    await expect(
      f.hook('beforeHandleAwareness', { ...f.payload, socketId: 'new-socket', states }),
    ).resolves.toBeUndefined();
  });
  it('ignores the empty scratch-awareness identity added by the transport', async () => {
    const f = fixture();
    await f.load();
    const states = new Map<number, unknown>([
      [99, {}],
      [1, state],
    ]);
    await f.hook('beforeHandleAwareness', { ...f.payload, states });
    expect([...states.keys()]).toEqual([1]);
    expect(states.get(1)).toMatchObject({ userId: f.grant.userId });
    await f.hook('beforeHandleAwareness', {
      ...f.payload,
      states: new Map<number, unknown>([
        [100, {}],
        [1, state],
      ]),
    });
  });
  it('drops invalid cursor data and rejects multiple identities per update', async () => {
    const f = fixture();
    await f.load();
    const states = new Map([[1, { ...state, cursor: { x: 2, y: 0 } }]]);
    await f.hook('beforeHandleAwareness', { ...f.payload, states });
    expect(states.size).toBe(0);
    await expect(
      f.hook('beforeHandleAwareness', {
        ...f.payload,
        states: new Map([
          [1, state],
          [2, state],
        ]),
      }),
    ).rejects.toThrow();
    await f.hook('beforeHandleAwareness', { ...f.payload, states: new Map([[1, null]]) });
    await f.hook('beforeHandleAwareness', { ...f.payload, context: undefined, states });
    await f.hook('afterUnloadDocument', f.payload);
    await expect(f.hook('beforeHandleAwareness', { ...f.payload, states })).rejects.toThrow();
    await f.hook('onDisconnect', f.payload);
    await f.hook('afterUnloadDocument', f.payload);
    await f.service.persist(f.grant.documentName, f.document);
  });
  it('freezes the room on lost lease and closes clients whose author access is revoked', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.load();
    const connection = { close: vi.fn() };
    await f.hook('connected', { ...f.payload, connection });
    const close = vi.spyOn(f.server.hocuspocus, 'closeConnections');
    f.leases.renew.mockRejectedValue(new Error('lease lost'));
    f.version.state = 'published';
    await vi.advanceTimersByTimeAsync(10000);
    expect(close).toHaveBeenCalledWith(f.grant.documentName);
    expect(connection.close).toHaveBeenCalledOnce();
    await expect(f.hook('beforeHandleMessage', f.payload)).rejects.toThrow();
    await f.hook('onDisconnect', f.payload);
  });
});

it('does not access Redis or tenant SQL for awareness/message authorization between periodic checks', async () => {
  const f = fixture();
  await f.load();
  f.leases.renew.mockClear();
  f.authorize.mockClear();
  f.abilities.forPrincipal.mockClear();
  for (let index = 0; index < 10; index++) await f.hook('beforeHandleMessage', f.payload);
  expect(f.leases.renew).not.toHaveBeenCalled();
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.abilities.forPrincipal).not.toHaveBeenCalled();
});

it('marks collaboration unavailable when its listener fails', async () => {
  const f = fixture(true, true);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.service.ready()).toBe(false);
});
