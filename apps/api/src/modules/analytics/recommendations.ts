import { significance } from './metrics.js';

/** One experiment arm: terminal sessions only count toward outcomes; `unresolved` are sessions
 *  with no terminal event (lost or still open), i.e. potential data loss. */
export interface OutcomeCohort {
  readonly key: string;
  readonly sessions: number;
  readonly completed: number;
  readonly unresolved: number;
}
export type RecommendationReason =
  'ok' | 'needs-two-cohorts' | 'insufficient-sample' | 'data-loss' | 'not-significant';
export interface Recommendation {
  readonly recommended: string | null;
  readonly reason: RecommendationReason;
  readonly difference: number | null;
  readonly pValue: number | null;
}
export interface RecommendationPolicy {
  readonly minSessionsPerCohort: number;
  readonly maxUnresolvedRatio: number;
}
export const DEFAULT_RECOMMENDATION_POLICY: RecommendationPolicy = {
  minSessionsPerCohort: 30,
  maxUnresolvedRatio: 0.05,
};
const none = (reason: RecommendationReason, difference: number | null = null): Recommendation => ({
  recommended: null,
  reason,
  difference,
  pValue: null,
});
/**
 * Recommends the better arm only when it is backed by verified, sufficiently large and
 * statistically significant outcomes. Anything else yields no recommendation and a reason.
 */
export function recommendVariant(
  cohorts: readonly OutcomeCohort[],
  policy: RecommendationPolicy = DEFAULT_RECOMMENDATION_POLICY,
): Recommendation {
  const [a, b] = cohorts;
  if (cohorts.length !== 2 || !a || !b) return none('needs-two-cohorts');
  for (const c of cohorts) {
    if (
      ![c.sessions, c.completed, c.unresolved].every(Number.isSafeInteger) ||
      c.sessions < 0 ||
      c.completed < 0 ||
      c.unresolved < 0 ||
      c.completed > c.sessions ||
      c.completed + c.unresolved > c.sessions
    )
      return none('data-loss');
  }
  if (cohorts.some((c) => c.sessions < policy.minSessionsPerCohort))
    return none('insufficient-sample');
  if (cohorts.some((c) => c.unresolved / c.sessions > policy.maxUnresolvedRatio))
    return none('data-loss');
  const test = significance(a, b);
  if (!test.significant || test.pValue === null) return none('not-significant', test.difference);
  return {
    recommended: test.difference > 0 ? b.key : a.key,
    reason: 'ok',
    difference: test.difference,
    pValue: test.pValue,
  };
}
