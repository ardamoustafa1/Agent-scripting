import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import nodemailer from 'nodemailer';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import { AnalyticsScheduleSchema, type AnalyticsFact } from '@verbis/shared-types';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { AbilityFactory } from '../authz/ability.factory.js';

import { csvReport } from './export.js';
import { aggregate } from './metrics.js';
import { AnalyticsStore } from './storage.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

export function nextRun(
  schedule: Pick<z.infer<typeof AnalyticsScheduleSchema>, 'frequency' | 'hourUtc'>,
  now: Date,
): Date {
  const next = new Date(now);
  next.setUTCHours(schedule.hourUtc, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  if (schedule.frequency === 'weekly')
    while (next.getUTCDay() !== 1) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
@Injectable()
export class AnalyticsReportScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly logger = new Logger(AnalyticsReportScheduler.name);
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(AnalyticsStore) private readonly store: AnalyticsStore,
  ) {}
  onApplicationBootstrap() {
    if (!this.env.ANALYTICS_ENABLED) return;
    if (
      this.env.ANALYTICS_REPORTS_ENABLED &&
      (!this.env.ANALYTICS_SMTP_URL || !this.env.ANALYTICS_MAIL_FROM)
    )
      throw new Error('Analytics reports require enabled analytics and SMTP configuration');
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.logger.warn('Analytics maintenance failed; retrying next tick');
      });
    }, 60000);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.client.$queryRaw<
        { id: string; settings: unknown }[]
      >`SELECT id,settings FROM analytics_active_tenants()`;
      for (const tenant of tenants)
        await requestContext.run(
          {
            ...systemContext(randomUUID(), 'analytics-scheduler'),
            principal: {
              type: 'service',
              id: 'analytics-scheduler',
              tenantId: tenant.id,
              scopes: [],
            },
          },
          () =>
            this.db.run(tenant.id, async (tx) => {
              const locked = await tx.$queryRaw<
                { settings: unknown }[]
              >`SELECT settings FROM tenants WHERE id=${tenant.id}::uuid FOR SHARE`;
              const settings = z
                .object({
                  audit: z
                    .object({
                      analyticsRetentionDays: z.number().int().min(30).max(36500).default(365),
                      legalHold: z.boolean().default(false),
                    })
                    .default({ analyticsRetentionDays: 365, legalHold: false }),
                })
                .safeParse(locked[0]?.settings);
              if (settings.success && !settings.data.audit.legalHold) {
                const cutoff = new Date(
                  Date.now() - settings.data.audit.analyticsRetentionDays * 86400000,
                );
                await this.store.purge(tx, tenant.id, cutoff);
              }
              if (!this.env.ANALYTICS_REPORTS_ENABLED) return;
              const due = await tx.$queryRaw<
                { id: string; definition: unknown; next_run_at: Date }[]
              >`SELECT id,definition,next_run_at FROM analytics_schedules WHERE tenant_id=${tenant.id}::uuid AND deleted_at IS NULL AND next_run_at<=now() AND definition->>'enabled'='true' ORDER BY next_run_at LIMIT 20 FOR UPDATE SKIP LOCKED`;
              for (const row of due) {
                const definition = AnalyticsScheduleSchema.parse(row.definition);
                await this.outbox.record(tx, {
                  type: 'verbis.analytics.report.requested.v1',
                  aggregateType: 'Report',
                  aggregateId: row.id,
                  payload: { scheduleId: row.id, runAt: row.next_run_at.toISOString() },
                });
                await tx.$executeRaw`UPDATE analytics_schedules SET next_run_at=${nextRun(definition, new Date())},updated_at=now() WHERE tenant_id=${tenant.id}::uuid AND id=${row.id}::uuid`;
              }
            }),
        );
    } finally {
      this.running = false;
    }
  }
}
@DomainEventHandler()
@Injectable()
export class AnalyticsReportConsumer implements EventHandler {
  readonly name = 'analytics-report-delivery';
  readonly stream = 'DOMAIN';
  readonly filterSubjects = ['verbis.analytics.report.requested.v1'];
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(AnalyticsStore) private readonly store: AnalyticsStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  get enabled() {
    return this.env.ANALYTICS_REPORTS_ENABLED;
  }
  async handle(event: EventEnvelope, tx: TransactionClient) {
    if (!this.env.ANALYTICS_REPORTS_ENABLED) throw new Error('Report delivery disabled');
    const payload = z
      .strictObject({ scheduleId: z.uuid(), runAt: z.iso.datetime() })
      .parse(event.payload);
    const rows = await tx.$queryRaw<
      { owner_id: string; definition: unknown }[]
    >`SELECT owner_id,definition FROM analytics_schedules WHERE tenant_id=${event.tenantId}::uuid AND id=${payload.scheduleId}::uuid AND deleted_at IS NULL`;
    const row = rows[0];
    if (!row) return;
    const schedule = AnalyticsScheduleSchema.parse(row.definition);
    if (!schedule.enabled) return;
    const tenant = await tx.tenant.findUnique({
      where: { id: event.tenantId },
      select: { settings: true },
    });
    if (!tenant) return;
    const ability = await this.abilities.forPrincipal(
      tx,
      { type: 'user', id: row.owner_id, tenantId: event.tenantId, authMethod: 'sso', scopes: [] },
      tenant.settings,
    );
    if (!ability?.ability.can('manage', 'Report')) return;
    const until = new Date(payload.runAt),
      span = Date.parse(schedule.filter.to) - Date.parse(schedule.filter.from);
    const filter = {
      ...schedule.filter,
      to: new Date(until.getTime() - 86400000).toISOString().slice(0, 10),
      from: new Date(until.getTime() - 86400000 - span).toISOString().slice(0, 10),
    };
    const facts = await this.store.read(tx, event.tenantId, filter);
    const scope = (f: AnalyticsFact) =>
      asSubject('Report', { campaignId: f.campaignId, teamId: f.teamId, scriptId: f.scriptId });
    const ownerFacts = facts.filter(
      (f) => ability.ability.can('read', scope(f)) && ability.ability.can('export', scope(f)),
    );
    const transport = nodemailer.createTransport(this.env.ANALYTICS_SMTP_URL ?? '');
    for (const id of schedule.recipientUserIds) {
      const recipient = await tx.user.findFirst({
        where: { id, tenantId: event.tenantId, status: 'active', deletedAt: null },
        select: { email: true },
      });
      if (!recipient?.email) continue;
      const access = await this.abilities.forPrincipal(
        tx,
        { type: 'user', id, tenantId: event.tenantId, authMethod: 'sso', scopes: [] },
        tenant.settings,
      );
      if (!access) continue;
      const data = aggregate(
        ownerFacts.filter(
          (f) => access.ability.can('read', scope(f)) && access.ability.can('export', scope(f)),
        ),
      );
      // Envelope addressing stays in the identity/control plane; facts never contain email addresses.
      await transport
        .sendMail({
          from: this.env.ANALYTICS_MAIL_FROM,
          to: recipient.email,
          subject: 'Verbis analytics',
          text: 'The authorized analytics report is attached.',
          messageId: `<${event.id}.${id}@reports.verbis>`,
          attachments: [
            {
              filename: 'analytics.csv',
              content: csvReport(data),
              contentType: 'text/csv; charset=utf-8',
            },
          ],
        })
        .catch(() => {
          throw new Error('Analytics report mail delivery failed');
        });
    }
    await this.audit.record(tx, {
      action: 'analytics.report.delivered',
      target: { type: 'Report', id: payload.scheduleId },
      metadata: { runAt: payload.runAt },
    });
  }
}
