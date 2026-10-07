import type { AnalyticsDashboard } from '@verbis/shared-types';

/**
 * Optimization insights (DIFFERENTIATORS E7): ranked, thresholded pointers derived from the
 * aggregates only. They state WHERE to look and why; the suggestion is a fixed i18n key, never
 * free text, so nothing here can leak data or invent facts. Small samples never produce insights.
 */
export type Insight = NonNullable<AnalyticsDashboard['insights']>[number];

export const MIN_SAMPLES = 30;
const DROP_OFF_RATE = 0.2;
const SLOW_FACTOR = 2;
const ERROR_RATE = 0.1;
const SLOW_SOURCE_MS = 2000;
const SOURCE_ERROR_RATE = 0.05;
const MAX_INSIGHTS = 10;

const median = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2),
    high = sorted[mid],
    low = sorted[mid - 1];
  if (high === undefined) return null;
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
};

export function insightsOf(
  d: Pick<AnalyticsDashboard, 'pages' | 'heatmap' | 'sources'>,
): Insight[] {
  const found: Insight[] = [];
  const pages = d.pages.filter((p) => p.sessions >= MIN_SAMPLES);
  for (const p of pages)
    if (p.dropOffRate >= DROP_OFF_RATE)
      found.push({
        kind: 'dropOff',
        target: p.key,
        value: p.dropOffRate,
        baseline: null,
        samples: p.sessions,
        impact: Math.round(p.dropOff),
      });
  const dwell = median(
    pages.flatMap((p) => (p.meanDwellMs === null ? [] : [p.meanDwellMs])).filter((v) => v > 0),
  );
  if (dwell !== null && pages.length >= 3)
    for (const p of pages)
      if (p.meanDwellMs !== null && p.meanDwellMs >= dwell * SLOW_FACTOR)
        found.push({
          kind: 'slowPage',
          target: p.key,
          value: p.meanDwellMs,
          baseline: dwell,
          samples: p.sessions,
          impact: Math.round(((p.meanDwellMs - dwell) * p.sessions) / 1000),
        });
  for (const h of d.heatmap)
    if (h.samples >= MIN_SAMPLES && h.errors / h.samples >= ERROR_RATE)
      found.push({
        kind: 'errorNode',
        target: `${h.versionId}:${h.pageId}:${h.nodeId}`,
        value: h.errors / h.samples,
        baseline: null,
        samples: h.samples,
        impact: h.errors,
      });
  for (const s of d.sources) {
    if (s.calls < MIN_SAMPLES) continue;
    if (s.meanLatencyMs >= SLOW_SOURCE_MS)
      found.push({
        kind: 'slowSource',
        target: s.key,
        value: s.meanLatencyMs,
        baseline: SLOW_SOURCE_MS,
        samples: s.calls,
        impact: Math.round(((s.meanLatencyMs - SLOW_SOURCE_MS) * s.calls) / 1000),
      });
    if (s.errorRate >= SOURCE_ERROR_RATE)
      found.push({
        kind: 'failingSource',
        target: s.key,
        value: s.errorRate,
        baseline: SOURCE_ERROR_RATE,
        samples: s.calls,
        impact: Math.round(s.errorRate * s.calls),
      });
  }
  return found
    .sort(
      (a, b) =>
        b.impact - a.impact || a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target),
    )
    .slice(0, MAX_INSIGHTS);
}
