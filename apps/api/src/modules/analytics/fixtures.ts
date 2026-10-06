import { AnalyticsFactSchema, type AnalyticsFact } from '@verbis/shared-types';

export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function fixtureFact(
  sequence: number,
  override: Partial<AnalyticsFact> = {},
): AnalyticsFact {
  return AnalyticsFactSchema.parse({
    eventId: fixtureId(sequence + 100),
    tenantId: fixtureId(1),
    sessionId: fixtureId(2),
    scriptId: fixtureId(3),
    versionId: fixtureId(4),
    campaignId: fixtureId(5),
    teamId: fixtureId(6),
    channel: 'voice',
    agent: 'a'.repeat(64),
    at: new Date(Date.UTC(2026, 9, 3, 9, 0, sequence * 10)).toISOString(),
    sequence,
    type: sequence === 0 ? 'start' : 'state',
    state: sequence === 0 ? 'launching' : 'active',
    pageId: null,
    nodeId: null,
    requiredReadIds: [],
    sourceId: null,
    outcome: null,
    variant: null,
    experimentId: null,
    durationMs: null,
    error: false,
    ...override,
  });
}
