import { describe, expect, it } from 'vitest';

import { AnalyticsFactSchema } from '@verbis/shared-types';

import { fixtureFact, fixtureId } from './fixtures.js';
import { aggregate, significance } from './metrics.js';

describe('analytics replay', () => {
  it('is invariant to delivery duplication and ordering', () => {
    const rows = [
      fixtureFact(0),
      fixtureFact(1, { type: 'page', pageId: 'welcome' }),
      fixtureFact(2, { state: 'completed', type: 'outcome', outcome: 'sale' }),
    ];
    const now = new Date('2026-10-03T10:00:00Z');
    expect(aggregate([...rows].reverse().concat(rows), false, now)).toEqual(
      aggregate(rows, false, now),
    );
    expect(aggregate(rows).meanDurationMs).toBe(20000);
  });
  it('counts abandonment on the last visited page and excludes unfinished dwell', () => {
    const rows = [
      fixtureFact(0),
      fixtureFact(1, { type: 'page', pageId: 'a' }),
      fixtureFact(3, { type: 'page', pageId: 'b' }),
      fixtureFact(4, { state: 'abandoned' }),
    ];
    const result = aggregate(rows);
    expect(result.pages.map((p) => [p.meanDwellMs, p.dropOffRate])).toEqual([
      [20000, 0],
      [10000, 1],
    ]);
    expect(result.paths).toEqual([
      { source: fixtureId(4) + ':a', target: fixtureId(4) + ':b', count: 1 },
    ]);
  });
  it('tracks required reads even when no acknowledgment was sent', () => {
    const result = aggregate([
      fixtureFact(0),
      fixtureFact(1, { type: 'page', pageId: 'legal', requiredReadIds: ['terms', 'disclaimer'] }),
      fixtureFact(2, { type: 'read', pageId: 'legal', nodeId: 'terms' }),
      fixtureFact(3, { state: 'completed' }),
    ]);
    expect(result.compliance).toEqual({ eligible: 2, acknowledged: 1, rate: 0.5 });
  });
  it('retracts a read acknowledgment and computes datasource error ratio', () => {
    const result = aggregate([
      fixtureFact(0),
      fixtureFact(1, { type: 'page', pageId: 'legal', requiredReadIds: ['terms'] }),
      fixtureFact(2, { type: 'read', pageId: 'legal', nodeId: 'terms' }),
      fixtureFact(3, { type: 'read', pageId: 'legal', nodeId: 'terms', error: true }),
      fixtureFact(4, { type: 'datasource', sourceId: 'crm', durationMs: 100 }),
      fixtureFact(5, { type: 'datasource', sourceId: 'crm', durationMs: 300, error: true }),
    ]);
    expect(result.compliance.rate).toBe(0);
    expect(result.sources[0]).toEqual({ key: 'crm', calls: 2, meanLatencyMs: 200, errorRate: 0.5 });
    expect(result.agents).toEqual([]);
  });
  it('does not call sparse or identical AB samples significant', () => {
    expect(significance({ sessions: 5, completed: 4 }, { sessions: 5, completed: 3 }).reason).toBe(
      'insufficient',
    );
    expect(
      significance({ sessions: 100, completed: 50 }, { sessions: 100, completed: 50 }).pValue,
    ).toBeCloseTo(1);
    expect(
      significance({ sessions: 1000, completed: 500 }, { sessions: 1000, completed: 700 })
        .significant,
    ).toBe(true);
  });
  it('expires stale supervisor observations without changing historical session counts', () => {
    const result = aggregate([fixtureFact(0)], true, new Date('2026-10-03T10:00:00Z'));
    expect(result.active).toEqual([]);
    expect(result.sessions).toBe(1);
  });
  it('rejects accidentally added PII rather than silently storing it', () => {
    expect(
      AnalyticsFactSchema.safeParse({
        ...fixtureFact(0),
        ani: '+905551234567',
        variables: { name: 'Customer' },
      }).success,
    ).toBe(false);
  });
});

describe('analytics operational edge cases', () => {
  const now = new Date('2026-10-03T09:10:00Z');
  it('reports empty input without NaN or fabricated compliance', () => {
    const result = aggregate([], true, now);
    expect(result).toMatchObject({
      sessions: 0,
      completed: 0,
      completionRate: 0,
      meanDurationMs: null,
      compliance: { eligible: 0, acknowledged: 0, rate: null },
      active: [],
      liveCampaigns: [],
    });
  });
  it('keeps active observations anonymous unless agent reporting is authorized', () => {
    const rows = [fixtureFact(0, { campaignId: null }), fixtureFact(1, { campaignId: null })];
    expect(aggregate(rows, false, now).active[0]?.agent).toBeNull();
    expect(aggregate(rows, true, now)).toMatchObject({
      active: [expect.objectContaining({ agent: 'a'.repeat(64) })],
      agents: [expect.objectContaining({ sessions: 1, completed: 0, meanDurationMs: null })],
      liveCampaigns: [{ key: 'unassigned', active: 1, completed: 0 }],
    });
    expect(aggregate(rows, false, new Date('2026-10-03T09:30:10Z')).active).toEqual([]);
  });
  it('counts repeated routes and visits independently from distinct sessions', () => {
    const rows = [
      fixtureFact(0),
      ...['a', 'b', 'a', 'b'].map((pageId, i) => fixtureFact(i + 1, { type: 'page', pageId })),
      fixtureFact(5, { state: 'expired' }),
    ];
    const result = aggregate(rows, false, now);
    expect(result.paths[0]).toMatchObject({
      source: fixtureId(4) + ':a',
      target: fixtureId(4) + ':b',
      count: 2,
    });
    expect(result.pages).toEqual([
      expect.objectContaining({ visits: 2, sessions: 1, dropOff: 0, meanDwellMs: 10000 }),
      expect.objectContaining({ visits: 2, sessions: 1, dropOff: 1, meanDwellMs: 10000 }),
    ]);
    expect(result.active).toEqual([]);
  });
  it('handles missing starts, clock skew, null latencies and field errors without invalid durations', () => {
    const result = aggregate(
      [
        fixtureFact(1, { type: 'page', pageId: 'a' }),
        fixtureFact(2, {
          type: 'datasource',
          sourceId: 'unmeasured',
          durationMs: null,
          error: true,
        }),
        fixtureFact(3, {
          type: 'field',
          pageId: 'a',
          nodeId: 'input',
          durationMs: 40,
          error: true,
        }),
        fixtureFact(4, { type: 'field', pageId: 'a', nodeId: 'input', durationMs: null }),
        fixtureFact(5, { state: 'completed', at: '2026-10-03T08:59:00.000Z' }),
      ],
      false,
      now,
    );
    expect(result.meanDurationMs).toBeNull();
    expect(result.pages[0]?.meanDwellMs).toBe(0);
    expect(result.sources).toEqual([
      { key: 'unmeasured', calls: 1, meanLatencyMs: 0, errorRate: 1 },
    ]);
    expect(result.heatmap).toEqual([
      expect.objectContaining({ samples: 2, errors: 1, meanDwellMs: 40 }),
    ]);
  });
  it('combines outcome counts and keeps unmeasured read dwell null', () => {
    const rows = [
      fixtureFact(0),
      fixtureFact(1, { type: 'outcome', outcome: 'SALE' }),
      fixtureFact(2, { type: 'outcome', outcome: 'SALE' }),
      fixtureFact(3, { type: 'read', nodeId: 'terms', pageId: 'legal' }),
    ];
    const result = aggregate(rows, false, now);
    expect(result.outcomes).toEqual([{ key: 'SALE', count: 2 }]);
    expect(result.heatmap[0]).toMatchObject({ samples: 1, meanDwellMs: null });
  });
  it('does not compare variants from separate experiments and preserves sparse inconclusive samples', () => {
    const result = aggregate(
      [
        fixtureFact(0, { experimentId: fixtureId(20), variant: 'A' }),
        fixtureFact(1, {
          sessionId: fixtureId(21),
          experimentId: fixtureId(20),
          variant: 'B',
          state: 'completed',
        }),
        fixtureFact(2, { sessionId: fixtureId(22), experimentId: fixtureId(23), variant: 'A' }),
      ],
      false,
      now,
    );
    expect(result.variants).toHaveLength(3);
    expect(result.comparisons).toEqual([
      expect.objectContaining({
        experimentId: fixtureId(20),
        a: 'A',
        b: 'B',
        pValue: null,
        significant: false,
        reason: 'insufficient',
      }),
    ]);
  });
  it('adjusts all three comparisons within a multi-variant experiment', () => {
    const rows = ['A', 'B', 'C'].flatMap((variant, group) =>
      Array.from({ length: 20 }, (_, index) =>
        fixtureFact(group * 20 + index, {
          sessionId: fixtureId(1000 + group * 20 + index),
          experimentId: fixtureId(20),
          variant,
          state: index < 10 + group ? 'completed' : 'abandoned',
        }),
      ),
    );
    const result = aggregate(rows, false, now);
    expect(result.comparisons).toHaveLength(3);
    const raw = significance({ sessions: 20, completed: 10 }, { sessions: 20, completed: 11 });
    expect(result.comparisons[0]?.pValue).toBeCloseTo(Math.min(1, (raw.pValue ?? 0) * 3));
    expect(result.comparisons.every((comparison) => !comparison.significant)).toBe(true);
  });
  it('keeps zero-session statistical samples inconclusive and finite', () => {
    expect(significance({ sessions: 0, completed: 0 }, { sessions: 0, completed: 0 })).toEqual({
      difference: 0,
      pValue: null,
      significant: false,
      reason: 'insufficient',
    });
  });
});
