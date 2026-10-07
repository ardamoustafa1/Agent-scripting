import { describe, expect, it } from 'vitest';

import { insightsOf, MIN_SAMPLES } from './insights.js';

const page = (key: string, sessions: number, dropOffRate: number, meanDwellMs: number) => ({
  key,
  visits: sessions,
  sessions,
  meanDwellMs,
  dropOff: Math.round(sessions * dropOffRate),
  dropOffRate,
});
const empty = { pages: [], heatmap: [], sources: [] };

describe('insightsOf', () => {
  it('is silent without enough samples, however bad the numbers look', () => {
    expect(
      insightsOf({
        pages: [page('v:a', MIN_SAMPLES - 1, 0.9, 99_000)],
        heatmap: [
          { versionId: 'v', pageId: 'a', nodeId: 'n', samples: 5, meanDwellMs: 1, errors: 5 },
        ],
        sources: [{ key: 'crm', calls: 10, meanLatencyMs: 9000, errorRate: 0.9 }],
      }),
    ).toEqual([]);
    expect(insightsOf(empty)).toEqual([]);
  });
  it('flags drop-off, slow pages relative to the median, error nodes and slow or failing sources', () => {
    const result = insightsOf({
      pages: [
        page('v:a', 100, 0.05, 10_000),
        page('v:b', 100, 0.4, 12_000),
        page('v:c', 100, 0.05, 40_000),
        page('v:d', 100, 0.05, 11_000),
      ],
      heatmap: [
        { versionId: 'v', pageId: 'b', nodeId: 'phone', samples: 80, meanDwellMs: 1, errors: 20 },
      ],
      sources: [{ key: 'crm', calls: 50, meanLatencyMs: 3000, errorRate: 0.1 }],
    });
    const kinds = result.map((i) => `${i.kind}:${i.target}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'dropOff:v:b',
        'slowPage:v:c',
        'errorNode:v:b:phone',
        'slowSource:crm',
        'failingSource:crm',
      ]),
    );
    expect(result.find((i) => i.kind === 'slowPage')).toMatchObject({ baseline: 11_500 });
    expect(result.some((i) => i.target === 'v:a')).toBe(false);
  });
  it('ranks by impact deterministically and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => page(`v:p${String(i)}`, 100 + i, 0.5, 1));
    const a = insightsOf({ ...empty, pages: many });
    expect(a).toHaveLength(10);
    expect(a.map((i) => i.impact)).toEqual([...a.map((i) => i.impact)].sort((x, y) => y - x));
    expect(insightsOf({ ...empty, pages: [...many].reverse() })).toEqual(a);
  });
  it('needs at least three comparable pages before calling any page slow', () => {
    expect(
      insightsOf({
        ...empty,
        pages: [page('v:a', 100, 0.01, 1000), page('v:b', 100, 0.01, 50_000)],
      }),
    ).toEqual([]);
  });
});
