import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import {
  AnalyticsDashboardSchema,
  type AnalyticsFilter,
  type AnalyticsFact,
  type AnalyticsScheduleSchema,
} from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import { ForbiddenError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';

import { AnalyticsRepository } from './analytics.repository.js';
import { csvReport, xlsxReport } from './export.js';
import { aggregate } from './metrics.js';
import { recommendVariant } from './recommendations.js';
import { nextRun } from './reports.js';
import { AnalyticsStore } from './storage.js';

import type { EventCountQuery, EventCountsDto } from './analytics.dto.js';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(AnalyticsStore) private readonly storage: AnalyticsStore,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AnalyticsRepository) private readonly repository: AnalyticsRepository,
  ) {}

  async dashboard(query: AnalyticsFilter, action: 'read' | 'export' = 'read') {
    const all = await this.storage.read(this.db.current(), this.db.tenantId(), query);
    const scope = (f: AnalyticsFact) =>
      asSubject('Report', { campaignId: f.campaignId, teamId: f.teamId, scriptId: f.scriptId });
    const allowed = all.filter(
      (f) => this.authz.can('read', scope(f)) && this.authz.can(action, scope(f)),
    );
    const agents = allowed.filter((f) =>
      this.authz.can(
        'reveal',
        asSubject('Session', { teamId: f.teamId, campaignId: f.campaignId, userId: null }),
      ),
    );
    const result = aggregate(allowed),
      sensitive = aggregate(agents, true);
    result.agents = sensitive.agents;
    for (const row of result.active)
      row.agent = sensitive.active.find((a) => a.sessionId === row.sessionId)?.agent ?? null;
    return AnalyticsDashboardSchema.parse(result);
  }
  async recommendations(query: AnalyticsFilter) {
    const all = await this.storage.read(this.db.current(), this.db.tenantId(), query);
    const allowed = all.filter((fact) =>
      this.authz.can(
        'read',
        asSubject('Report', {
          campaignId: fact.campaignId,
          teamId: fact.teamId,
          scriptId: fact.scriptId,
        }),
      ),
    );
    const result = aggregate(allowed),
      terminal = new Set(['completed', 'abandoned', 'expired']);
    const sessions = new Map<string, typeof allowed>();
    for (const fact of allowed) {
      const rows = sessions.get(fact.sessionId) ?? [];
      rows.push(fact);
      sessions.set(fact.sessionId, rows);
    }
    const experiments = [...new Set(result.variants.map((row) => row.experimentId))];
    return {
      data: experiments.map((experimentId) => {
        const cohorts = result.variants
          .filter((row) => row.experimentId === experimentId)
          .map((row) => ({
            key: row.key,
            sessions: row.sessions,
            completed: row.completed,
            unresolved: [...sessions.values()].filter(
              (facts) =>
                facts.some(
                  (fact) => fact.experimentId === experimentId && fact.variant === row.key,
                ) &&
                (!facts.some((fact) => terminal.has(fact.state)) ||
                  !facts.some((fact) => fact.type === 'start')),
            ).length,
          }));
        return { experimentId, ...recommendVariant(cohorts) };
      }),
    };
  }

  async export(query: AnalyticsFilter, format: 'csv' | 'xlsx') {
    const data = await this.dashboard(query, 'export');
    await this.audit.record(this.db.current(), {
      action: 'analytics.report.exported',
      target: { type: 'Report', id: this.db.tenantId() },
      metadata: { format, filter: query, sessions: data.sessions },
    });
    return format === 'csv' ? Buffer.from(csvReport(data)) : xlsxReport(data);
  }
  async schedules() {
    const actor = requestContext.require().principal;
    if (actor?.type !== 'user') throw new ForbiddenError();
    return this.db.current().$queryRaw<
      { id: string; definition: unknown; next_run_at: Date; version: number }[]
    >`SELECT id,definition,next_run_at,version FROM analytics_schedules WHERE tenant_id=${this.db.tenantId()}::uuid AND owner_id=${actor.id}::uuid AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`;
  }
  async schedule(input: z.infer<typeof AnalyticsScheduleSchema>) {
    const actor = requestContext.require().principal;
    if (actor?.type !== 'user') throw new ForbiddenError();
    const id = uuidv7(),
      tx = this.db.current(),
      next = nextRun(input, new Date());
    await tx.$executeRaw`INSERT INTO analytics_schedules(id,tenant_id,owner_id,definition,next_run_at,created_by,updated_by) VALUES(${id}::uuid,${actor.tenantId}::uuid,${actor.id}::uuid,${JSON.stringify(input)}::jsonb,${next},${'user:' + actor.id},${'user:' + actor.id})`;
    await this.audit.record(tx, {
      action: 'analytics.schedule.created',
      target: { type: 'Report', id },
      metadata: { frequency: input.frequency, recipientCount: input.recipientUserIds.length },
    });
    return { id, nextRunAt: next.toISOString() };
  }
  async deleteSchedule(id: string) {
    const actor = requestContext.require().principal;
    if (actor?.type !== 'user') throw new ForbiddenError();
    await this.db.current()
      .$executeRaw`UPDATE analytics_schedules SET deleted_at=now(),version=version+1,updated_at=now(),updated_by=${'user:' + actor.id} WHERE tenant_id=${actor.tenantId}::uuid AND id=${id}::uuid AND owner_id=${actor.id}::uuid AND deleted_at IS NULL`;
    await this.audit.record(this.db.current(), {
      action: 'analytics.schedule.deleted',
      target: { type: 'Report', id },
    });
    return { deleted: true };
  }
  async eventCounts(query: EventCountQuery): Promise<EventCountsDto> {
    this.authz.authorize('read', asSubject('Report', {}));
    const rows = await this.repository.counts(this.db.current(), this.db.tenantId(), query);
    return {
      data: rows.map((row) => ({
        eventType: row.eventType,
        day: row.day.toISOString().slice(0, 10),
        count: row.count,
      })),
    };
  }
}
