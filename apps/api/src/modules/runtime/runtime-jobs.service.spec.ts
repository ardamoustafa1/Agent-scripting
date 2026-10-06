import { afterEach, expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';
import { Keyring } from '../identity/crypto/keyring.js';

import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';

import type { RuntimeEngineService } from './runtime-engine.service.js';
import type { RuntimePorts } from './runtime-ports.js';
import type { ApiEnv } from '../../env.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { Job, Processor } from 'bullmq';

const transport = vi.hoisted(() => ({ queue: vi.fn(), worker: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function (...args: unknown[]) {
    return transport.queue(...args) as object;
  }),
  Worker: vi.fn(function (...args: unknown[]) {
    return transport.worker(...args) as object;
  }),
}));

const tenantId = '01990000-0000-7000-8000-000000000001';
const sessionId = '01990000-0000-7000-8000-000000000002';
const eventId = '01990000-0000-7000-8000-000000000003';
const outcomeId = '01990000-0000-7000-8000-000000000004';
const services: RuntimeJobsService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.onModuleDestroy();
  vi.restoreAllMocks();
});

function fixture(enabled = true) {
  const connection = { on: vi.fn(), duplicate: vi.fn(), disconnect: vi.fn() };
  connection.duplicate.mockReturnValue(connection);
  const queues = new Map<string, ReturnType<typeof queueDouble>>();
  function queueDouble() {
    return {
      on: vi.fn(),
      add: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 3, delayed: 1 }),
      getFailedCount: vi.fn().mockResolvedValue(4),
    };
  }
  const processors = new Map<string, Processor>();
  const worker = { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  transport.queue.mockImplementation((name: string) => {
    const queue = queueDouble();
    queues.set(name, queue);
    return queue;
  });
  transport.worker.mockImplementation((name: string, processor: Processor) => {
    processors.set(name, processor);
    return worker;
  });
  const keys = new RuntimeCipher(
    new Keyring(`synthetic:${Buffer.alloc(32, 9).toString('base64')}`),
  );
  const row = {
    interaction: {
      connectorId: 'synthetic-connector' as string | null,
      externalId: 'synthetic-interaction',
    },
  };
  const outcome = {
    code: 'DONE',
    subCodes: ['SYNTHETIC'],
    sealedData: keys.seal(
      JSON.stringify({ fields: { public: 'visible' }, note: 'Synthetic note' }),
      `runtime:outcome:${tenantId}:${sessionId}`,
    ) as string | null,
    callbackAt: new Date('2026-10-05T00:00:00Z') as Date | null,
  };
  const tx = {
    session: { findFirst: vi.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000) }) },
    outcome: { findFirstOrThrow: vi.fn().mockResolvedValue(outcome) },
  };
  const engine = {
    expire: vi.fn().mockResolvedValue(undefined),
    row: vi.fn().mockResolvedValue(row),
  };
  const connector = {
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    writeOutcome: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn().mockResolvedValue({}) };
  const db = {
    run: vi.fn((_tenant: string, fn: (tx: TransactionClient) => Promise<unknown>) =>
      fn(tx as unknown as TransactionClient),
    ),
  };
  const service = new RuntimeJobsService(
    { client: connection } as unknown as RedisService,
    { EVENT_CONSUMERS_ENABLED: enabled } as ApiEnv,
    db as unknown as TenantDb,
    engine as unknown as RuntimeEngineService,
    { connector: () => connector } as unknown as RuntimePorts,
    keys,
    audit as unknown as AuditService,
  );
  services.push(service);
  const process = (data: unknown) =>
    processors.get('runtime-writeback')!({ data } as Job, 'synthetic-token');
  return {
    service,
    queues,
    processors,
    worker,
    connection,
    tx,
    engine,
    connector,
    audit,
    row,
    outcome,
    keys,
    db,
    process,
  };
}

function event(type: string, payload: Record<string, unknown> = {}): EventEnvelope {
  return {
    id: eventId,
    type,
    tenantId,
    aggregate: { type: 'Session', id: sessionId },
    occurredAt: new Date().toISOString(),
    actor: 'synthetic',
    correlationId: eventId,
    payload,
  };
}

it('does not start disabled consumers or emit artificial zero metric samples', async () => {
  const f = fixture(false),
    observe = vi.fn();
  f.service.onApplicationBootstrap();
  await f.service.sampleWriteback({ observe });
  await f.service.sampleFailed({ observe });
  expect(f.processors.size).toBe(0);
  expect(f.queues.size).toBe(0);
  expect(observe).not.toHaveBeenCalled();
});

it('separates expiry from connector writeback and preserves retry/idempotency options', async () => {
  const f = fixture();
  await f.service.enqueue(
    event('verbis.runtime.session.created.v1'),
    f.tx as unknown as TransactionClient,
  );
  const expiry = f.queues.get('runtime')!;
  expect(expiry.add.mock.calls[0]?.[0]).toBe('expire');
  expect(expiry.add.mock.calls[0]?.[2]).toMatchObject({
    jobId: eventId,
    attempts: 8,
    removeOnFail: false,
    delay: expect.any(Number) as unknown,
  });
  const expiryOptions = expiry.add.mock.calls[0]?.[2] as { delay: number };
  expect(expiryOptions.delay).toBeGreaterThan(0);
  await f.service.enqueue(
    event('verbis.runtime.outcome.submitted.v1', { outcomeId }),
    f.tx as unknown as TransactionClient,
  );
  await f.service.enqueue(
    event('verbis.runtime.recording.requested.v1', { paused: false }),
    f.tx as unknown as TransactionClient,
  );
  expect(
    f.queues.get('runtime-writeback')!.add.mock.calls.map(([kind]) => kind as unknown),
  ).toEqual(['outcome', 'recording']);
  expect(f.service.queue()).toBe(expiry);
  expect(f.connection.duplicate).toHaveBeenCalledTimes(1);
});

it.each([null, undefined])(
  'ignores expiry events without a session deadline: %s',
  async (expiresAt) => {
    const f = fixture();
    f.tx.session.findFirst.mockResolvedValue({ expiresAt });
    await f.service.enqueue(
      event('verbis.runtime.session.created.v1'),
      f.tx as unknown as TransactionClient,
    );
    expect(f.queues.size).toBe(0);
  },
);

it('runs expiry in the tenant transaction and records no connector writeback audit', async () => {
  const f = fixture();
  f.service.onApplicationBootstrap();
  await f.process({ tenantId, sessionId, eventId, kind: 'expire' });
  expect(f.engine.expire).toHaveBeenCalledWith(f.tx, sessionId);
  expect(f.engine.row).not.toHaveBeenCalled();
  expect(f.audit.record).not.toHaveBeenCalled();
  expect(f.db.run.mock.calls[0]?.[0]).toBe(tenantId);
  expect(typeof f.db.run.mock.calls[0]?.[1]).toBe('function');
});

it.each([true, false])(
  'writes recording command %s and audits only its identifier',
  async (paused) => {
    const f = fixture();
    f.service.onApplicationBootstrap();
    await f.process({
      tenantId,
      sessionId,
      eventId,
      kind: 'recording',
      paused,
      traceContext: { traceparent: '' },
    });
    expect(f.connector.pauseRecording).toHaveBeenCalledWith({
      tenantId,
      interactionId: 'synthetic-interaction',
      commandId: eventId,
      paused,
    });
    expect(f.audit.record).toHaveBeenCalledWith(f.tx, {
      action: 'runtime.connector.recording',
      target: { type: 'Session', id: sessionId },
      metadata: { commandId: eventId },
    });
    expect(requestContext.get()).toBeUndefined();
  },
);

it.each([true, false])(
  'opens the scoped outcome envelope with optional details %s',
  async (optional) => {
    const f = fixture();
    if (!optional) {
      f.outcome.callbackAt = null;
      f.outcome.sealedData = f.keys.seal(
        JSON.stringify({ fields: {} }),
        `runtime:outcome:${tenantId}:${sessionId}`,
      );
    }
    f.service.onApplicationBootstrap();
    await f.process({ tenantId, sessionId, eventId, kind: 'outcome', outcomeId });
    expect(f.connector.writeOutcome).toHaveBeenCalledWith({
      tenantId,
      interactionId: 'synthetic-interaction',
      commandId: eventId,
      code: 'DONE',
      subCodes: ['SYNTHETIC'],
      fields: optional ? { public: 'visible' } : {},
      ...(optional ? { note: 'Synthetic note', callbackAt: '2026-10-05T00:00:00.000Z' } : {}),
    });
    expect(f.tx.outcome.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: outcomeId, tenantId, sessionId, deletedAt: null },
    });
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('Synthetic note');
  },
);

it.each(['connector', 'recording', 'outcome', 'ciphertext', 'transport'] as const)(
  'fails safely on %s without auditing successful delivery',
  async (reason) => {
    const f = fixture();
    if (reason === 'connector') f.row.interaction.connectorId = null;
    if (reason === 'ciphertext') f.outcome.sealedData = null;
    if (reason === 'transport')
      f.connector.writeOutcome.mockRejectedValue(new Error('synthetic-private-provider-message'));
    f.service.onApplicationBootstrap();
    const data = {
      tenantId,
      sessionId,
      eventId,
      kind: reason === 'recording' ? 'recording' : 'outcome',
      ...(reason !== 'outcome' ? { outcomeId } : {}),
    };
    await expect(f.process(data)).rejects.toThrow(
      'Runtime job failed; inspect connector health and retry configuration',
    );
    expect(f.audit.record).not.toHaveBeenCalled();
  },
);

it('reports queue backlog and failures, omitting samples during a transport outage', async () => {
  const f = fixture();
  f.service.onApplicationBootstrap();
  const observe = vi.fn();
  await f.service.sampleWriteback({ observe });
  await f.service.sampleFailed({ observe });
  expect(observe.mock.calls).toEqual([[6], [4]]);
  observe.mockClear();
  f.queues.get('runtime-writeback')!.getJobCounts.mockRejectedValue(new Error('synthetic-outage'));
  f.queues
    .get('runtime-writeback')!
    .getFailedCount.mockRejectedValue(new Error('synthetic-outage'));
  await f.service.sampleWriteback({ observe });
  await f.service.sampleFailed({ observe });
  expect(observe).not.toHaveBeenCalled();
});
