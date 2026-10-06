import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  AnalyticsFactSchema,
  type AnalyticsFact,
  type AnalyticsFilter,
} from '@verbis/shared-types';

import { ValidationError } from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

export interface AnalyticsStorage {
  append(tx: TransactionClient, fact: AnalyticsFact): Promise<void>;
  read(tx: TransactionClient, tenantId: string, filter: AnalyticsFilter): Promise<AnalyticsFact[]>;
}
const limit = 50000;
/** Fixed statements only; tenant binding is mandatory on every adapter operation. */
@Injectable()
export class AnalyticsStore implements AnalyticsStorage {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    if (env.ANALYTICS_ENABLED && !env.ANALYTICS_PSEUDONYM_KEY)
      throw new Error('ANALYTICS_PSEUDONYM_KEY is required');
    if (
      env.ANALYTICS_ENABLED &&
      env.ANALYTICS_STORAGE === 'clickhouse' &&
      !env.ANALYTICS_CLICKHOUSE_URL
    )
      throw new Error('ANALYTICS_CLICKHOUSE_URL is required');
  }
  async append(tx: TransactionClient, fact: AnalyticsFact) {
    const safe = AnalyticsFactSchema.parse(fact);
    // Serialize projection with the privacy workflow's operational session update.
    await tx.$queryRaw`SELECT id FROM sessions WHERE tenant_id=${safe.tenantId}::uuid AND id=${safe.sessionId}::uuid FOR SHARE`;
    const erased = await tx.$queryRaw<
      { session_id: string }[]
    >`SELECT session_id FROM analytics_erased_sessions WHERE tenant_id=${safe.tenantId}::uuid AND session_id=${safe.sessionId}::uuid`;
    if (erased.length) return;
    await tx.$executeRaw`INSERT INTO analytics_facts(tenant_id,event_id,occurred_at,session_id,fact) VALUES(${safe.tenantId}::uuid,${safe.eventId}::uuid,${new Date(safe.at)},${safe.sessionId}::uuid,${JSON.stringify(safe)}::jsonb) ON CONFLICT DO NOTHING`;
    if (this.env.ANALYTICS_STORAGE === 'clickhouse')
      await this.clickhouse(
        "INSERT INTO analytics_facts SETTINGS date_time_input_format='best_effort' FORMAT JSONEachRow",
        {},
        JSON.stringify({
          tenant_id: safe.tenantId,
          event_id: safe.eventId,
          occurred_at: safe.at,
          session_id: safe.sessionId,
          fact: JSON.stringify(safe),
        }) + '\n',
      );
  }
  async read(tx: TransactionClient, tenantId: string, filter: AnalyticsFilter) {
    if (!this.env.ANALYTICS_ENABLED) return [];
    const from = new Date(filter.from),
      until = new Date(Date.parse(filter.to) + 86400000);
    let facts: AnalyticsFact[];
    if (this.env.ANALYTICS_STORAGE === 'clickhouse') {
      const data = await this.clickhouse(
        'SELECT fact FROM analytics_facts FINAL WHERE tenant_id={tenant:UUID} AND occurred_at >= parseDateTime64BestEffort({from:String}) AND occurred_at < parseDateTime64BestEffort({until:String}) ORDER BY occurred_at LIMIT 50001 FORMAT JSONEachRow',
        { tenant: tenantId, from: from.toISOString(), until: until.toISOString() },
      );
      facts = data.trim()
        ? data
            .trim()
            .split('\n')
            .map((line) =>
              AnalyticsFactSchema.parse(
                JSON.parse(z.object({ fact: z.string() }).parse(JSON.parse(line)).fact),
              ),
            )
        : [];
    } else {
      const rows = await tx.$queryRaw<
        { fact: unknown }[]
      >`SELECT fact FROM analytics_facts WHERE tenant_id=${tenantId}::uuid AND occurred_at>=${from} AND occurred_at<${until} ORDER BY occurred_at LIMIT 50001`;
      facts = rows.map((row) => AnalyticsFactSchema.parse(row.fact));
    }
    if (facts.length > limit)
      throw new ValidationError([
        { path: '/from', message: 'Too many events; narrow the date range' },
      ]);
    const cohort = new Set(facts.filter((f) => f.type === 'start').map((f) => f.sessionId));
    return facts.filter(
      (f) =>
        f.tenantId === tenantId &&
        cohort.has(f.sessionId) &&
        (!filter.campaignId || f.campaignId === filter.campaignId) &&
        (!filter.scriptId || f.scriptId === filter.scriptId) &&
        (!filter.teamId || f.teamId === filter.teamId) &&
        (!filter.channel || f.channel === filter.channel),
    );
  }
  async purge(tx: TransactionClient, tenantId: string, cutoff: Date) {
    await tx.$executeRaw`DELETE FROM analytics_facts WHERE tenant_id=${tenantId}::uuid AND occurred_at<${cutoff}`;
    if (this.env.ANALYTICS_STORAGE === 'clickhouse')
      await this.clickhouse(
        'ALTER TABLE analytics_facts DELETE WHERE tenant_id={tenant:UUID} AND occurred_at < parseDateTime64BestEffort({cutoff:String}) SETTINGS mutations_sync=1',
        { tenant: tenantId, cutoff: cutoff.toISOString() },
      );
  }
  async eraseSessions(tx: TransactionClient, tenantId: string, sessionIds: string[]) {
    const ids = z.array(z.uuid()).max(1001).parse(sessionIds);
    if (!ids.length) return;
    await tx.$executeRaw`INSERT INTO analytics_erased_sessions(tenant_id,session_id) SELECT ${tenantId}::uuid,jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid ON CONFLICT DO NOTHING`;
    await tx.$executeRaw`DELETE FROM analytics_facts WHERE tenant_id=${tenantId}::uuid AND session_id IN(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
    if (this.env.ANALYTICS_STORAGE === 'clickhouse')
      await this.clickhouse(
        'ALTER TABLE analytics_facts DELETE WHERE tenant_id={tenant:UUID} AND session_id IN {sessions:Array(UUID)} SETTINGS mutations_sync=1',
        { tenant: tenantId, sessions: '[' + ids.map((id) => "'" + id + "'").join(',') + ']' },
      );
  }
  private async clickhouse(query: string, params: Record<string, string>, body?: string) {
    const url = new URL(this.env.ANALYTICS_CLICKHOUSE_URL ?? '');
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid ClickHouse protocol');
    url.searchParams.set('query', query);
    for (const [k, v] of Object.entries(params)) url.searchParams.set('param_' + k, v);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-ClickHouse-User': this.env.ANALYTICS_CLICKHOUSE_USER ?? 'default',
        'X-ClickHouse-Key': this.env.ANALYTICS_CLICKHOUSE_PASSWORD ?? '',
        'Content-Type': 'text/plain',
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('ClickHouse operation failed');
    const text = await response.text();
    if (text.length > 32_000_000) throw new Error('ClickHouse response too large');
    return text;
  }
}
