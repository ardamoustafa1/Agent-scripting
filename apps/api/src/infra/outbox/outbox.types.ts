import { z } from 'zod';

/** `verbis.<context>.<aggregate>.<event>.v<N>` (CLAUDE.md §5). */
export const EVENT_SUBJECT =
  /^verbis\.[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.v[1-9][0-9]*$/;

export interface DomainEventInput {
  /** NATS subject, e.g. `verbis.campaigns.campaign.created.v1`. */
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Must already be redacted of PII/PCI. */
  readonly payload: Record<string, unknown>;
}

/** Wire format published to NATS JetStream and parsed by consumers. */
export const EventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().regex(EVENT_SUBJECT),
  tenantId: z.uuid(),
  aggregate: z.object({ type: z.string(), id: z.string() }),
  occurredAt: z.iso.datetime({ offset: true }),
  correlationId: z.string(),
  actor: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** Row shape returned by the outbox_claim() SQL function. */
export interface OutboxRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  attempts: number;
  created_at: Date;
  created_by: string;
}

export function envelopeFromRow(row: OutboxRow): EventEnvelope {
  return {
    id: row.id,
    type: row.event_type,
    tenantId: row.tenant_id,
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    occurredAt: row.created_at.toISOString(),
    correlationId: row.headers['correlationId'] ?? row.id,
    actor: row.created_by,
    payload: row.payload,
  };
}
