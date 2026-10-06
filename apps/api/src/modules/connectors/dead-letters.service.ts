import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import { HubClient } from './hub-client.js';

export const DeadLetterStatsSchema = z
  .object({
    durable: z.boolean(),
    persisted: z.number().int().nonnegative(),
    persistFailures: z.number().int().nonnegative(),
  })
  .meta({ id: 'ConnectorDeadLetterStats' });
export type DeadLetterStats = z.infer<typeof DeadLetterStatsSchema>;

export const ReplayRequestSchema = z
  .strictObject({ limit: z.number().int().min(1).max(1_000).default(100) })
  .meta({ id: 'ConnectorDeadLetterReplayRequest' });
export type ReplayRequest = z.infer<typeof ReplayRequestSchema>;

export const ReplayResultSchema = z
  .object({ replayed: z.number().int().nonnegative() })
  .meta({ id: 'ConnectorDeadLetterReplayResult' });

const HubStatusSchema = z.object({ deadLetters: DeadLetterStatsSchema });

/**
 * Operator view/replay of the connector hub's durable DLQ (ADR-0041). The hub scopes replay to
 * the tenant in the signed service token; the browser never reaches the hub. Event payloads are
 * never returned or audited, only counters.
 */
@Injectable()
export class DeadLettersService {
  constructor(
    @Inject(HubClient) private readonly hub: HubClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  async stats(): Promise<DeadLetterStats> {
    const status = await this.hub.call(
      this.db.tenantId(),
      'GET',
      '/internal/v1/connectors',
      HubStatusSchema,
    );
    return status.deadLetters;
  }

  async replay(limit: number): Promise<{ replayed: number }> {
    const tenantId = this.db.tenantId();
    const before = await this.stats();
    const result = await this.hub.call(
      tenantId,
      'POST',
      '/internal/v1/dead-letters/replay',
      ReplayResultSchema,
      { limit },
    );
    const after = await this.stats().catch(() => before);
    // Same request transaction as the audit chain + outbox (CLAUDE.md §6).
    await this.audit.record(this.db.current(), {
      action: 'connector.deadletter.replayed',
      target: { type: 'Connector', id: tenantId },
      before: { persisted: before.persisted, persistFailures: before.persistFailures },
      after: { persisted: after.persisted, persistFailures: after.persistFailures },
      metadata: { requested: limit, replayed: result.replayed },
    });
    return result;
  }
}
