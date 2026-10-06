import { describe, expect, it } from 'vitest';

import {
  AnalyticsFilterSchema,
  AnalyticsFactSchema,
  AnalyticsScheduleSchema,
} from './analytics.js';

const id = '01928f3a-0000-7000-8000-0000000000ff';
describe('analytics privacy and scheduling contracts', () => {
  it.each([
    ['2026-01-01', '2026-01-01', true],
    ['2026-01-01', '2027-01-01', true],
    ['2026-01-01', '2027-01-02', false],
    ['2026-01-02', '2026-01-01', false],
    ['invalid', '2026-01-01', false],
  ])('bounds date range %s to %s', (from, to, valid) => {
    expect(AnalyticsFilterSchema.safeParse({ from, to }).success).toBe(valid);
  });
  const fact = {
    eventId: id,
    tenantId: id,
    sessionId: id,
    scriptId: id,
    versionId: id,
    campaignId: null,
    teamId: null,
    channel: 'voice',
    agent: 'a'.repeat(64),
    at: '2026-10-03T12:00:00Z',
    sequence: 0,
    requiredReadIds: [],
    type: 'start',
    state: 'active',
    pageId: null,
    nodeId: null,
    sourceId: null,
    outcome: null,
    variant: null,
    experimentId: null,
    durationMs: null,
    error: false,
  };
  it('accepts metadata and rejects raw customer values and unbounded identifiers', () => {
    expect(AnalyticsFactSchema.parse(fact)).toEqual(fact);
    for (const bad of [
      { customer: 'private' },
      { agent: 'customer@example.test' },
      { channel: 'a'.repeat(129) },
      { durationMs: 86400001 },
      { sequence: -1 },
      { sequence: 0.5 },
    ])
      expect(AnalyticsFactSchema.safeParse({ ...fact, ...bad }).success).toBe(false);
  });
  it('requires recipients and accepts only whole UTC hours', () => {
    const schedule = {
      filter: { from: '2026-10-01', to: '2026-10-03' },
      frequency: 'daily',
      hourUtc: 0,
      enabled: true,
      recipientUserIds: [id],
    };
    expect(AnalyticsScheduleSchema.parse(schedule)).toEqual(schedule);
    for (const bad of [
      { recipientUserIds: [] },
      { recipientUserIds: Array.from({ length: 21 }, () => id) },
      { hourUtc: -1 },
      { hourUtc: 24 },
      { hourUtc: 1.5 },
      { frequency: 'hourly' },
    ])
      expect(AnalyticsScheduleSchema.safeParse({ ...schedule, ...bad }).success).toBe(false);
  });
});
