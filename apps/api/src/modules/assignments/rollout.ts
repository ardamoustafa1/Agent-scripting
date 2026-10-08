import type { AnalyticsDashboard } from '@verbis/shared-types';

import type { Variant } from '../routing/domain/ab.js';

/**
 * Staged rollout (canary) decisions, ADR-0049. A rollout is NOT new state: it is an A/B
 * assignment whose two arms are named `stable` and `canary`, so bucketing, sticky routing,
 * analytics attribution and audit all reuse the existing A/B path. The stage is the canary weight.
 */
export const STABLE = 'stable';
export const CANARY = 'canary';
/** Canary traffic in basis points: 5%, 25%, 50%, 100%. */
export const STAGES = [500, 2500, 5000, 10_000] as const;
export const DEFAULT_MIN_SESSIONS = 100;

export interface RolloutArms {
  readonly stable: Variant;
  readonly canary: Variant;
}
/** The two arms of a canary assignment, or null when the assignment is not a rollout. */
export function rolloutArms(variants: readonly Variant[] | null): RolloutArms | null {
  if (variants?.length !== 2) return null;
  const stable = variants.find((v) => v.key === STABLE),
    canary = variants.find((v) => v.key === CANARY);
  return stable && canary ? { stable, canary } : null;
}

export type GuardMetric = 'abandonment' | 'compliance';
export interface RolloutEvidence {
  readonly stableSessions: number;
  readonly canarySessions: number;
  /** canary minus stable completion rate with its always-valid verdict (ADR-0048). */
  readonly primary: { readonly difference: number; readonly significant: boolean } | null;
  readonly guardrails: readonly {
    readonly metric: GuardMetric;
    readonly worse: typeof STABLE | typeof CANARY | null;
  }[];
}
export type RolloutReason =
  | 'not-a-rollout'
  | 'not-started'
  | 'complete'
  | 'guardrail-breached'
  | 'completion-dropped'
  | 'insufficient-sessions'
  | 'no-harm-detected';
export interface RolloutDecision {
  readonly action: 'none' | 'hold' | 'advance' | 'rollback';
  readonly reason: RolloutReason;
  /** Metrics that caused a rollback. */
  readonly breached: readonly string[];
  /** Canary weight now and after the proposal, in basis points. */
  readonly from: number | null;
  readonly to: number | null;
  /** The full variants array to PATCH; absent when no change is proposed. */
  readonly proposal?: readonly Variant[];
}

const withWeights = (arms: RolloutArms, canary: number): Variant[] => [
  { ...arms.stable, weight: 10_000 - canary },
  { ...arms.canary, weight: canary },
];
const none = (reason: RolloutReason, from: number | null = null): RolloutDecision => ({
  action: 'none',
  reason,
  breached: [],
  from,
  to: from,
});

/**
 * Pure decision. Rollback is the only action ever taken automatically and only on POSITIVE
 * evidence of harm (a significantly worse guardrail or completion, always-valid p-values so
 * early looks are safe). Advancing needs enough traffic AND no harm, but absence of a
 * significant difference is not proof of safety, so `advance` is advisory: a person applies it.
 */
export function decideRollout(
  variants: readonly Variant[] | null,
  evidence: RolloutEvidence,
  minSessions = DEFAULT_MIN_SESSIONS,
): RolloutDecision {
  const arms = rolloutArms(variants);
  if (!arms) return none('not-a-rollout');
  const weight = arms.canary.weight;
  if (weight <= 0) return none('not-started', 0);
  if (weight >= 10_000) return none('complete', weight);
  const breached = [
    ...evidence.guardrails.filter((g) => g.worse === CANARY).map((g) => g.metric as string),
    ...(evidence.primary?.significant && evidence.primary.difference < 0 ? ['completion'] : []),
  ];
  if (breached.length > 0)
    return {
      action: 'rollback',
      reason:
        breached.includes('completion') && breached.length === 1
          ? 'completion-dropped'
          : 'guardrail-breached',
      breached,
      from: weight,
      to: 0,
      proposal: withWeights(arms, 0),
    };
  if (evidence.canarySessions < minSessions || evidence.stableSessions < minSessions)
    return {
      action: 'hold',
      reason: 'insufficient-sessions',
      breached: [],
      from: weight,
      to: weight,
    };
  const next = STAGES.find((stage) => stage > weight);
  if (next === undefined) return none('complete', weight);
  return {
    action: 'advance',
    reason: 'no-harm-detected',
    breached: [],
    from: weight,
    to: next,
    proposal: withWeights(arms, next),
  };
}

/** Starting a rollout: the first stage, on top of the currently serving (stable) version. */
export function startProposal(
  stableVersionId: string | undefined,
  canaryVersionId: string,
): Variant[] {
  return [
    {
      key: STABLE,
      weight: 10_000 - STAGES[0],
      ...(stableVersionId === undefined ? {} : { pinnedVersionId: stableVersionId }),
    },
    { key: CANARY, weight: STAGES[0], pinnedVersionId: canaryVersionId },
  ];
}

/**
 * Reads the stable-vs-canary evidence for ONE experiment out of an aggregated dashboard. The
 * comparison/guardrail rows are oriented by variant order, so the sign is normalised here so that
 * every value reads as canary relative to stable.
 */
export function evidenceOf(
  dashboard: Pick<AnalyticsDashboard, 'variants' | 'comparisons' | 'guardrails'>,
  experimentId: string,
): RolloutEvidence {
  const sessions = (key: string) =>
      dashboard.variants.find((v) => v.experimentId === experimentId && v.key === key)?.sessions ??
      0,
    pair = (row: { experimentId: string; a: string; b: string }): boolean =>
      row.experimentId === experimentId &&
      ((row.a === STABLE && row.b === CANARY) || (row.a === CANARY && row.b === STABLE));
  const comparison = dashboard.comparisons.find(pair);
  return {
    stableSessions: sessions(STABLE),
    canarySessions: sessions(CANARY),
    primary:
      comparison === undefined
        ? null
        : {
            difference: comparison.a === CANARY ? -comparison.difference : comparison.difference,
            significant: comparison.anytimeSignificant === true,
          },
    guardrails: (dashboard.guardrails ?? []).filter(pair).map((g) => ({
      metric: g.metric,
      worse: g.worse === CANARY ? CANARY : g.worse === STABLE ? STABLE : null,
    })),
  };
}
