import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type Processor } from 'bullmq';
import { z } from 'zod';

import { instruments, messagingHeaders, consumeMessage } from '@verbis/observability';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';

import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimeEngineService } from './runtime-engine.service.js';
import { RuntimePorts } from './runtime-ports.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';
import type { Redis } from 'ioredis';

const JobSchema = z.strictObject({
  traceContext: z
    .strictObject({
      traceparent: z.string().max(128).optional(),
      tracestate: z.string().max(512).optional(),
    })
    .optional(),
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  eventId: z.uuid(),
  kind: z.enum(['expire', 'outcome', 'recording']),
  outcomeId: z.uuid().optional(),
  paused: z.boolean().optional(),
});
@Injectable()
export class RuntimeJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  #queue: Queue | undefined;
  #worker: Worker | undefined;
  #writebackQueue: Queue | undefined;
  #writebackWorker: Worker | undefined;
  #connection: Redis | undefined;
  #workerConnection: Redis | undefined;
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(RuntimePorts) private readonly ports: RuntimePorts,
    @Inject(RuntimeCipher) private readonly keys: RuntimeCipher,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  queue(): Queue {
    if (this.#queue === undefined) {
      // BullMQ owns its key prefix; producers fail fast and workers use unlimited retries.
      this.#connection = this.redis.client.duplicate({
        keyPrefix: '',
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 2000,
      });
      this.#connection.on('error', () => undefined);
      this.#queue = new Queue('runtime', { connection: this.#connection, prefix: 'verbis:jobs' });
      this.#queue.on('error', () => undefined);
    }
    return this.#queue;
  }
  writebackQueue(): Queue {
    this.queue();
    if (!this.#writebackQueue) {
      if (!this.#connection) throw new Error('Runtime queue connection unavailable');
      this.#writebackQueue = new Queue('runtime-writeback', {
        connection: this.#connection,
        prefix: 'verbis:jobs',
      });
      this.#writebackQueue.on('error', () => undefined);
    }
    return this.#writebackQueue;
  }
  readonly sampleWriteback = async (result: { observe(value: number): void }) => {
    if (!this.#writebackQueue) return;
    try {
      const counts = await this.#writebackQueue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'prioritized',
        'waiting-children',
      );
      result.observe(Object.values(counts).reduce((total, count) => total + count, 0));
    } catch {
      /* Missing sample on outage, never a false zero. */
    }
  };
  readonly sampleFailed = async (result: { observe(value: number): void }) => {
    if (!this.#writebackQueue) return;
    try {
      result.observe(await this.#writebackQueue.getFailedCount());
    } catch {
      /* absent */
    }
  };
  onApplicationBootstrap(): void {
    if (!this.env.EVENT_CONSUMERS_ENABLED) return;
    this.writebackQueue();
    instruments.writebackQueue.addCallback(this.sampleWriteback);
    instruments.writebackFailed.addCallback(this.sampleFailed);
    if (this.#connection === undefined) return;
    this.#workerConnection = this.#connection.duplicate({
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      commandTimeout: undefined,
    });
    this.#workerConnection.on('error', () => undefined);
    const processJob: Processor = async (job) => {
      const data = JobSchema.parse(job.data);
      const principal = {
        type: 'service' as const,
        id: 'runtime-worker',
        tenantId: data.tenantId,
        scopes: [],
      };
      try {
        await consumeMessage(
          {
            traceparent: data.traceContext?.traceparent ?? '',
            tracestate: data.traceContext?.tracestate ?? '',
          },
          () =>
            requestContext.run(
              { ...systemContext(data.eventId, 'runtime-worker'), principal },
              () =>
                this.db.run(data.tenantId, async (tx) => {
                  requestContext.require().tx = tx;
                  if (data.kind === 'expire') {
                    await this.engine.expire(tx, data.sessionId);
                    return;
                  }
                  const row = await this.engine.row(data.sessionId);
                  if (
                    row.interaction?.connectorId === null ||
                    row.interaction?.connectorId === undefined
                  )
                    throw new Error('Connector unavailable');
                  const connector = this.ports.connector(row.interaction.connectorId);
                  if (data.kind === 'recording') {
                    if (data.paused === undefined) throw new Error('Recording command missing');
                    await connector.pauseRecording({
                      tenantId: data.tenantId,
                      interactionId: row.interaction.externalId,
                      commandId: data.eventId,
                      paused: data.paused,
                    });
                  } else {
                    if (data.outcomeId === undefined) throw new Error('Outcome reference missing');
                    const outcome = await tx.outcome.findFirstOrThrow({
                      where: {
                        id: data.outcomeId,
                        tenantId: data.tenantId,
                        sessionId: data.sessionId,
                        deletedAt: null,
                      },
                    });
                    const details = z
                      .object({
                        note: z.string().optional(),
                        fields: z.record(z.string(), z.unknown()),
                      })
                      .parse(
                        JSON.parse(
                          this.keys.openString(
                            outcome.sealedData ?? '',
                            `runtime:outcome:${data.tenantId}:${data.sessionId}`,
                          ),
                        ),
                      );
                    await connector.writeOutcome({
                      tenantId: data.tenantId,
                      interactionId: row.interaction.externalId,
                      commandId: data.eventId,
                      code: outcome.code,
                      subCodes: outcome.subCodes,
                      fields: details.fields,
                      ...(details.note === undefined ? {} : { note: details.note }),
                      ...(outcome.callbackAt === null
                        ? {}
                        : { callbackAt: outcome.callbackAt.toISOString() }),
                    });
                  }
                  await this.audit.record(tx, {
                    action: `runtime.connector.${data.kind}`,
                    target: { type: 'Session', id: data.sessionId },
                    metadata: { commandId: data.eventId },
                  });
                }),
            ),
        );
      } catch {
        throw new Error('Runtime job failed; inspect connector health and retry configuration');
      }
    };
    const workerOptions = {
      connection: this.#workerConnection,
      prefix: 'verbis:jobs',
      concurrency: 8,
    };
    this.#worker = new Worker('runtime', processJob, workerOptions);
    this.#writebackWorker = new Worker('runtime-writeback', processJob, workerOptions);
    this.#writebackWorker.on('error', () => undefined);
    this.#worker.on('error', () => undefined);
  }
  async enqueue(event: EventEnvelope, tx: TransactionClient): Promise<void> {
    const kind =
      event.type === 'verbis.runtime.outcome.submitted.v1'
        ? 'outcome'
        : event.type === 'verbis.runtime.recording.requested.v1'
          ? 'recording'
          : 'expire';
    let delay = 0;
    if (kind === 'expire') {
      const row = await tx.session.findFirst({
        where: { id: event.aggregate.id, tenantId: event.tenantId },
        select: { expiresAt: true },
      });
      if (row?.expiresAt === null || row?.expiresAt === undefined) return;
      delay = Math.max(0, row.expiresAt.getTime() - Date.now());
    }
    const data = JobSchema.parse({
      traceContext: messagingHeaders(),
      tenantId: event.tenantId,
      sessionId: event.aggregate.id,
      eventId: event.id,
      kind,
      ...(kind === 'outcome' ? { outcomeId: event.payload['outcomeId'] } : {}),
      ...(kind === 'recording' ? { paused: event.payload['paused'] } : {}),
    });
    await (kind === 'expire' ? this.queue() : this.writebackQueue()).add(kind, data, {
      jobId: event.id,
      delay,
      attempts: 8,
      backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
      removeOnComplete: { age: 7 * 86400 },
      removeOnFail: false,
    });
  }
  async onModuleDestroy(): Promise<void> {
    instruments.writebackQueue.removeCallback(this.sampleWriteback);
    instruments.writebackFailed.removeCallback(this.sampleFailed);
    await this.#worker?.close();
    await this.#writebackWorker?.close();
    await this.#writebackQueue?.close();
    await this.#queue?.close();
    this.#connection?.disconnect();
    this.#workerConnection?.disconnect();
  }
}
