import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { requestContext, systemContext } from '../common/context/request-context.js';
import { ulid } from '../common/ids/ulid.js';
import { type ApiEnv, API_ENV } from '../env.js';
import { PrismaService } from '../infra/database/prisma.service.js';
import { TenantDb } from '../infra/database/tenant-db.js';
import { AuditRepository } from '../modules/audit/audit.repository.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { toBigInt, toInt } from '../modules/audit/core/scalars.js';
import { KafkaSink, type KafkaProducer } from '../modules/audit/siem/kafka.sink.js';
import {
  KafkaConfigSchema,
  PermanentDeliveryError,
  SyslogConfigSchema,
  WebhookConfigSchema,
  type SiemSink,
} from '../modules/audit/siem/sink.js';
import { SyslogTlsSink } from '../modules/audit/siem/syslog.sink.js';
import { WebhookSink } from '../modules/audit/siem/webhook.sink.js';

import { type SecretResolver } from './secret-resolver.js';

export const SECRET_RESOLVER = Symbol('SECRET_RESOLVER');
export const KAFKA_PRODUCER = Symbol('KAFKA_PRODUCER');
const LEASE_SECONDS = 120;
const SYSTEM_ACTOR = { type: 'system', id: 'audit-worker:siem' } as const;

interface DueDestination {
  id: string;
  tenantId: string;
  kind: string;
  format: string;
  config: unknown;
  secretRef: string | null;
  lastSeq: bigint;
  attempts: number;
}

/** Exponential backoff with full jitter, capped (attempt 1 → ≤2s, …). */
export function backoffSeconds(
  attempts: number,
  capSeconds: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(capSeconds, 2 ** Math.min(attempts, 20));
  return Math.max(1, Math.round(ceiling * random()));
}

/** Error text stored on the cursor: type + bounded message, no URLs/secrets. */
export function describeDeliveryError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return `${error.name}: ${error.message.replace(/https?:\/\/\S+/g, '<url>')}`.slice(0, 300);
}

/**
 * Ordered, at-least-once SIEM delivery per destination:
 * claim (lease, SKIP LOCKED) → read rows after the cursor → deliver → advance the cursor.
 * Nothing is skipped: a failing destination retries with backoff and keeps its position, and
 * receivers dedupe on (tenantId, seq). Status transitions are audited.
 */
@Injectable()
export class SiemDispatcher {
  readonly #logger = new Logger(SiemDispatcher.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AuditRepository) private readonly repository: AuditRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SECRET_RESOLVER) private readonly secrets: SecretResolver,
    @Optional() @Inject(KAFKA_PRODUCER) private readonly kafka?: KafkaProducer,
  ) {}

  async tick(): Promise<void> {
    // Cross-tenant discovery (read-only worker policy); every write runs in a tenant transaction.
    const due = await this.prisma.client.$queryRaw<{ id: string; tenantId: string }[]>`
      SELECT c.destination_id AS id, c.tenant_id AS "tenantId"
        FROM siem_cursors c JOIN siem_destinations d ON d.id = c.destination_id
       WHERE d.enabled AND d.deleted_at IS NULL AND c.next_attempt_at <= now()
       ORDER BY c.next_attempt_at LIMIT 100`;
    for (const { id, tenantId } of due) await this.deliverOne(tenantId, id);
  }

  async deliverOne(
    tenantId: string,
    destinationId: string,
  ): Promise<'delivered' | 'idle' | 'failed' | 'busy'> {
    const ctx = systemContext(ulid(), 'audit-worker:siem');
    return requestContext.run(ctx, async () => {
      const claimed = await this.tenantDb.run(tenantId, async (tx) => {
        const rows = await tx.$queryRaw<DueDestination[]>`
          SELECT d.id, d.tenant_id AS "tenantId", d.kind, d.format, d.config, d.secret_ref AS "secretRef",
                 c.last_seq AS "lastSeq", c.attempts
            FROM siem_cursors c JOIN siem_destinations d ON d.id = c.destination_id
           WHERE c.destination_id = ${destinationId}::uuid AND d.enabled AND d.deleted_at IS NULL
             AND c.next_attempt_at <= now()
             FOR UPDATE OF c SKIP LOCKED`;
        const row = rows[0];
        if (row === undefined) return undefined;
        await tx.$executeRaw`
          UPDATE siem_cursors SET next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS})
           WHERE destination_id = ${destinationId}::uuid`;
        const events = await this.repository.range(
          tx,
          tenantId,
          toBigInt(row.lastSeq),
          undefined,
          this.env.SIEM_BATCH_SIZE,
        );
        return {
          destination: { ...row, lastSeq: toBigInt(row.lastSeq), attempts: toInt(row.attempts) },
          events,
        };
      });
      if (claimed === undefined) return 'busy';
      const { destination, events } = claimed;
      if (events.length === 0) {
        await this.tenantDb.run(
          tenantId,
          (tx) =>
            tx.$executeRaw`UPDATE siem_cursors SET next_attempt_at = now() + interval '5 seconds' WHERE destination_id = ${destinationId}::uuid`,
        );
        return 'idle';
      }
      let sink: SiemSink | undefined;
      try {
        sink = await this.#sink(destination);
        await sink.deliver(events);
      } catch (error) {
        await this.#failed(destination, error);
        return 'failed';
      } finally {
        await sink?.close().catch(() => undefined);
      }
      const lastSeq = events[events.length - 1]?.seq ?? destination.lastSeq;
      await this.tenantDb.run(tenantId, async (tx) => {
        await tx.$executeRaw`
          UPDATE siem_cursors SET last_seq = ${lastSeq}, attempts = 0, last_error = NULL,
                 delivered_at = now(), next_attempt_at = now()
           WHERE destination_id = ${destinationId}::uuid AND last_seq = ${destination.lastSeq}`;
        if (destination.attempts > 0) {
          await this.audit.recordMany(
            tx,
            [
              {
                action: 'audit.siemDelivery.recovered',
                target: { type: 'SiemDestination', id: destinationId },
                actor: SYSTEM_ACTOR,
                metadata: { lastSeq: lastSeq.toString() },
              },
            ],
            { tenantId },
          );
        }
      });
      return 'delivered';
    });
  }

  async #failed(destination: DueDestination, error: unknown): Promise<void> {
    const attempts = destination.attempts + 1;
    const delay = backoffSeconds(attempts, this.env.SIEM_MAX_BACKOFF_SECONDS);
    const message = describeDeliveryError(error);
    this.#logger.warn(`SIEM delivery to ${destination.id} failed (attempt ${String(attempts)})`);
    await this.tenantDb.run(destination.tenantId, async (tx) => {
      await tx.$executeRaw`
        UPDATE siem_cursors SET attempts = ${attempts}, last_error = ${message},
               next_attempt_at = now() + make_interval(secs => ${delay})
         WHERE destination_id = ${destination.id}::uuid`;
      // Audit the transition into failure (and every 10th attempt), not every retry.
      if (attempts === 1 || attempts % 10 === 0) {
        await this.audit.recordMany(
          tx,
          [
            {
              action: 'audit.siemDelivery.failed',
              target: { type: 'SiemDestination', id: destination.id },
              outcome: 'failure',
              actor: SYSTEM_ACTOR,
              reason: error instanceof PermanentDeliveryError ? 'permanent' : 'transient',
              metadata: {
                attempts,
                error: message,
                pendingAfterSeq: destination.lastSeq.toString(),
              },
            },
          ],
          { tenantId: destination.tenantId },
        );
      }
    });
  }

  async #sink(destination: DueDestination): Promise<SiemSink> {
    const productVersion = this.env.APP_VERSION;
    switch (destination.kind) {
      case 'syslog':
        return new SyslogTlsSink(SyslogConfigSchema.parse(destination.config), {
          format: destination.format as 'rfc5424' | 'cef' | 'json',
          productVersion,
        });
      case 'webhook': {
        if (destination.secretRef === null)
          throw new PermanentDeliveryError('webhook secret missing');
        const secret = await this.secrets.resolve(destination.tenantId, destination.secretRef);
        return new WebhookSink(WebhookConfigSchema.parse(destination.config), secret);
      }
      case 'kafka':
        if (this.kafka === undefined)
          throw new PermanentDeliveryError('kafka producer not configured');
        return new KafkaSink(KafkaConfigSchema.parse(destination.config), this.kafka);
      default:
        throw new PermanentDeliveryError(`unknown destination kind`);
    }
  }
}
