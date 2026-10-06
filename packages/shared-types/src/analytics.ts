import { z } from 'zod';

const key = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
export const AnalyticsFilterSchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    campaignId: z.uuid().optional(),
    scriptId: z.uuid().optional(),
    channel: z
      .enum([
        'voice',
        'chat',
        'email',
        'video',
        'social',
        'messaging',
        'sms',
        'whatsapp',
        'callback',
      ])
      .optional(),
    teamId: z.uuid().optional(),
  })
  .refine((v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 365, {
    message: 'Date range must be ordered and at most 366 days',
  })
  .meta({ id: 'AnalyticsFilter' });
export type AnalyticsFilter = z.infer<typeof AnalyticsFilterSchema>;
/** Metadata only. No free-form strings, variable values, request bodies, notes or customer identifiers. */
export const AnalyticsFactSchema = z.strictObject({
  eventId: z.uuid(),
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  scriptId: z.uuid(),
  versionId: z.uuid(),
  campaignId: z.uuid().nullable(),
  teamId: z.uuid().nullable(),
  channel: key,
  agent: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.iso.datetime({ offset: true }),
  sequence: z.number().int().nonnegative(),
  requiredReadIds: z.array(key).max(1000),
  type: z.enum(['start', 'state', 'page', 'datasource', 'field', 'read', 'outcome']),
  state: z.enum(['launching', 'active', 'paused', 'wrapup', 'completed', 'abandoned', 'expired']),
  pageId: key.nullable(),
  nodeId: key.nullable(),
  sourceId: key.nullable(),
  outcome: key.nullable(),
  variant: key.nullable(),
  experimentId: z.uuid().nullable(),
  durationMs: z.number().nonnegative().max(86400000).nullable(),
  error: z.boolean(),
});
export type AnalyticsFact = z.infer<typeof AnalyticsFactSchema>;
const metric = z.object({
  key: z.string(),
  sessions: z.number(),
  completed: z.number(),
  completionRate: z.number(),
  meanDurationMs: z.number().nullable(),
});
export const AnalyticsDashboardSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    sampleEvents: z.number(),
    sessions: z.number(),
    completed: z.number(),
    completionRate: z.number(),
    meanDurationMs: z.number().nullable(),
    scripts: z.array(metric),
    agents: z.array(metric),
    pages: z.array(
      z.object({
        key: z.string(),
        visits: z.number(),
        sessions: z.number(),
        meanDwellMs: z.number().nullable(),
        dropOff: z.number(),
        dropOffRate: z.number(),
      }),
    ),
    paths: z.array(z.object({ source: z.string(), target: z.string(), count: z.number() })),
    outcomes: z.array(z.object({ key: z.string(), count: z.number() })),
    sources: z.array(
      z.object({
        key: z.string(),
        calls: z.number(),
        meanLatencyMs: z.number(),
        errorRate: z.number(),
      }),
    ),
    heatmap: z.array(
      z.object({
        versionId: z.string(),
        pageId: z.string(),
        nodeId: z.string(),
        samples: z.number(),
        meanDwellMs: z.number().nullable(),
        errors: z.number(),
      }),
    ),
    compliance: z.object({
      eligible: z.number(),
      acknowledged: z.number(),
      rate: z.number().nullable(),
    }),
    variants: z.array(metric.extend({ experimentId: z.string() })),
    comparisons: z.array(
      z.object({
        experimentId: z.string(),
        a: z.string(),
        b: z.string(),
        difference: z.number(),
        pValue: z.number().nullable(),
        significant: z.boolean(),
        reason: z.enum(['sufficient', 'insufficient']),
      }),
    ),
    active: z.array(
      z.object({
        sessionId: z.string(),
        scriptId: z.string(),
        campaignId: z.string().nullable(),
        agent: z.string().nullable(),
        state: z.string(),
        since: z.iso.datetime({ offset: true }),
      }),
    ),
    liveCampaigns: z.array(
      z.object({ key: z.string(), active: z.number(), completed: z.number() }),
    ),
  })
  .meta({ id: 'AnalyticsDashboard' });
export type AnalyticsDashboard = z.infer<typeof AnalyticsDashboardSchema>;
export const AnalyticsScheduleSchema = z
  .strictObject({
    filter: AnalyticsFilterSchema,
    frequency: z.enum(['daily', 'weekly']),
    hourUtc: z.number().int().min(0).max(23),
    enabled: z.boolean(),
    recipientUserIds: z.array(z.uuid()).min(1).max(20),
  })
  .meta({ id: 'AnalyticsSchedule' });

export type AnalyticsSchedule = z.infer<typeof AnalyticsScheduleSchema>;
