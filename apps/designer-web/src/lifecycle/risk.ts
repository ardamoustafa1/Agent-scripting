import type { ScriptHealth } from '../editor/health.js';

/**
 * Release risk (DIFFERENTIATORS B5): one explainable level from quality, tests, change size, new
 * personal-data flows and reach. Advisory only; the server publication gate stays authoritative.
 */
export interface RiskInput {
  health: Pick<ScriptHealth, 'score' | 'errors'>;
  scenarios: number;
  /** Branch coverage of saved scenarios, null while unknown or when the flow has no branches. */
  coveragePercent: number | null;
  /** JSON Patch operations against the baseline version. */
  changes: number;
  removedPages: number;
  newDataFlows: number;
  riskyNewDataFlows: number;
  /** Null when the reader may not list assignments. */
  impact: { assignments: number; campaigns: number } | null;
}
export type RiskFactor =
  | 'blockingIssues'
  | 'lowHealth'
  | 'noTests'
  | 'lowCoverage'
  | 'partialCoverage'
  | 'newExposure'
  | 'newDataFlows'
  | 'largeChange'
  | 'mediumChange'
  | 'removedPages'
  | 'wideImpact';
export interface ReleaseRisk {
  level: 'low' | 'medium' | 'high';
  /** 0 (no known risk) – 100. */
  score: number;
  factors: { factor: RiskFactor; points: number }[];
}

export function releaseRisk(input: RiskInput): ReleaseRisk {
  const factors: ReleaseRisk['factors'] = [];
  const add = (factor: RiskFactor, points: number) => {
    factors.push({ factor, points });
  };
  if (input.health.errors > 0) add('blockingIssues', 40);
  else if (input.health.score < 75) add('lowHealth', 15);
  if (input.scenarios === 0) add('noTests', 30);
  else if (input.coveragePercent !== null && input.coveragePercent < 50) add('lowCoverage', 20);
  else if (input.coveragePercent !== null && input.coveragePercent < 80) add('partialCoverage', 10);
  if (input.riskyNewDataFlows > 0) add('newExposure', Math.min(50, input.riskyNewDataFlows * 25));
  if (input.newDataFlows > input.riskyNewDataFlows) add('newDataFlows', 10);
  if (input.changes > 50) add('largeChange', 15);
  else if (input.changes > 10) add('mediumChange', 5);
  if (input.removedPages > 0) add('removedPages', 10);
  if (input.impact && (input.impact.campaigns >= 3 || input.impact.assignments >= 5))
    add('wideImpact', 10);
  const score = Math.min(
    100,
    factors.reduce((sum, item) => sum + item.points, 0),
  );
  factors.sort((a, b) => b.points - a.points);
  return { level: score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low', score, factors };
}

/** Pages a patch removes outright (`remove /pages/<n>`). */
export function removedPages(patch: readonly { op: string; path: string }[]): number {
  return patch.filter((op) => op.op === 'remove' && /^\/pages\/\d+$/.test(op.path)).length;
}
