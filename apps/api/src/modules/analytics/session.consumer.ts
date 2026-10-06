import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AnalyticsFactSchema } from '@verbis/shared-types';

import { API_ENV, type ApiEnv } from '../../env.js';
import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';

import { AnalyticsStore } from './storage.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

const eventSchema = z.object({
  sequence: z.number().int(),
  state: AnalyticsFactSchema.shape.state,
  eventType: z.string(),
  analytics: z
    .object({
      pageId: z.string().nullable(),
      nodeId: z.string().nullable(),
      requiredReadIds: z.array(z.string()),
      durationMs: z.number().nullable(),
      error: z.boolean(),
    })
    .optional(),
  event: z.record(z.string(), z.unknown()),
});
const technical = AnalyticsFactSchema.shape.nodeId;
export function pseudonym(key: string, tenant: string, user: string) {
  return createHmac('sha256', Buffer.from(key, 'base64'))
    .update('analytics:v1:' + tenant + ':' + user)
    .digest('hex');
}
@DomainEventHandler()
@Injectable()
export class AnalyticsSessionConsumer implements EventHandler {
  readonly name = 'analytics-session-projection';
  readonly stream = 'SESSION';
  readonly filterSubjects = ['verbis.runtime.session.changed.v1'];
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AnalyticsStore) private readonly storage: AnalyticsStore,
  ) {}
  get enabled() {
    return this.env.ANALYTICS_ENABLED;
  }
  async handle(envelope: EventEnvelope, tx: TransactionClient) {
    if (!this.env.ANALYTICS_ENABLED) return;
    const event = eventSchema.parse(envelope.payload);
    // Both streams retain the call for their own purpose; count only the executor's actual result.
    if (
      event.eventType === 'datasource.called' &&
      envelope.type === 'verbis.runtime.session.changed.v1'
    )
      return;
    const row = await tx.session.findFirst({
      where: { id: envelope.aggregate.id, tenantId: envelope.tenantId, kind: 'interaction' },
      select: {
        id: true,
        userId: true,
        teamId: true,
        assignmentId: true,
        decisionTrace: true,
        scriptVersionId: true,
        scriptVersion: { select: { scriptId: true } },
        interaction: { select: { campaignId: true, channelType: true } },
      },
    });
    if (!row) return;
    const kind: Record<
      string,
      'start' | 'state' | 'page' | 'datasource' | 'field' | 'read' | 'outcome'
    > = {
      'session.created': 'start',
      'session.transitioned': 'state',
      'page.entered': 'page',
      'datasource.called': 'datasource',
      'field.observed': 'field',
      'text.acknowledged': 'read',
      'outcome.submitted': 'outcome',
    };
    const type = kind[event.eventType];
    if (!type) return;
    const trace = z
      .object({ analyticsVariant: z.string().nullable().optional() })
      .safeParse(row.decisionTrace);
    const detail = event.event;
    const fact = AnalyticsFactSchema.parse({
      eventId: envelope.id,
      tenantId: envelope.tenantId,
      sessionId: row.id,
      scriptId: row.scriptVersion.scriptId,
      versionId: row.scriptVersionId,
      campaignId: row.interaction?.campaignId ?? null,
      teamId: row.teamId,
      channel: row.interaction?.channelType ?? 'voice',
      agent: pseudonym(this.env.ANALYTICS_PSEUDONYM_KEY ?? '', envelope.tenantId, row.userId),
      at: envelope.occurredAt,
      sequence: event.sequence,
      type,
      state: event.state,
      pageId:
        event.analytics?.pageId ?? (type === 'page' ? technical.parse(detail['pageId']) : null),
      nodeId: event.analytics?.nodeId ?? null,
      requiredReadIds: event.analytics?.requiredReadIds ?? [],
      sourceId: type === 'datasource' ? technical.parse(detail['name']) : null,
      outcome: type === 'outcome' ? technical.parse(detail['code']) : null,
      variant: trace.success ? technical.parse(trace.data.analyticsVariant ?? null) : null,
      experimentId: row.assignmentId,
      durationMs:
        event.analytics?.durationMs ??
        (type === 'datasource' ? z.number().min(0).max(300000).parse(detail['durationMs']) : null),
      error: event.analytics?.error ?? detail['status'] === 'failure',
    });
    await this.storage.append(tx, fact);
  }
}

@DomainEventHandler()
@Injectable()
export class AnalyticsDataSourceConsumer implements EventHandler {
  readonly name = 'analytics-datasource-projection';
  readonly stream = 'DOMAIN';
  readonly filterSubjects = ['verbis.analytics.datasource.executed.v1'];
  constructor(
    @Inject(AnalyticsSessionConsumer) private readonly sessions: AnalyticsSessionConsumer,
  ) {}
  get enabled() {
    return this.sessions.enabled;
  }
  handle(event: EventEnvelope, tx: TransactionClient) {
    return this.sessions.handle(event, tx);
  }
}
