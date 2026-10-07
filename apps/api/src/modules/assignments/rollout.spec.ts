import { describe, expect, it } from 'vitest';

import {
  decideRollout,
  evidenceOf,
  rolloutArms,
  startProposal,
  STAGES,
  type RolloutEvidence,
} from './rollout.js';

import type { Variant } from '../routing/domain/ab.js';

const v1 = '00000000-0000-4000-8000-000000000001';
const v2 = '00000000-0000-4000-8000-000000000002';
const arms = (canary: number): Variant[] => [
  { key: 'stable', weight: 10_000 - canary, pinnedVersionId: v1 },
  { key: 'canary', weight: canary, pinnedVersionId: v2 },
];
const clean: RolloutEvidence = {
  stableSessions: 500,
  canarySessions: 200,
  primary: { difference: 0.01, significant: false },
  guardrails: [
    { metric: 'abandonment', worse: null },
    { metric: 'compliance', worse: null },
  ],
};

describe('rolloutArms', () => {
  it('recognises only the exact stable/canary pair', () => {
    expect(rolloutArms(arms(500))?.canary.pinnedVersionId).toBe(v2);
    expect(rolloutArms(null)).toBeNull();
    expect(
      rolloutArms([
        { key: 'a', weight: 5000 },
        { key: 'b', weight: 5000 },
      ]),
    ).toBeNull();
    expect(rolloutArms([...arms(500), { key: 'x', weight: 0 }])).toBeNull();
  });
});

describe('decideRollout', () => {
  it('does nothing for plain A/B tests, not-started and finished rollouts', () => {
    expect(decideRollout(null, clean).reason).toBe('not-a-rollout');
    expect(decideRollout(arms(0), clean)).toMatchObject({ action: 'none', reason: 'not-started' });
    expect(decideRollout(arms(10_000), clean)).toMatchObject({
      action: 'none',
      reason: 'complete',
    });
  });
  it('rolls back on a significantly worse guardrail, keeping both pinned versions', () => {
    const decision = decideRollout(arms(2500), {
      ...clean,
      guardrails: [
        { metric: 'abandonment', worse: 'canary' },
        { metric: 'compliance', worse: null },
      ],
    });
    expect(decision).toMatchObject({
      action: 'rollback',
      reason: 'guardrail-breached',
      breached: ['abandonment'],
      from: 2500,
      to: 0,
    });
    expect(decision.proposal).toEqual(arms(0));
  });
  it('rolls back on a significant completion drop, but not on a significant improvement', () => {
    const drop = decideRollout(arms(500), {
      ...clean,
      primary: { difference: -0.08, significant: true },
    });
    expect(drop).toMatchObject({ action: 'rollback', reason: 'completion-dropped' });
    const gain = decideRollout(arms(500), {
      ...clean,
      primary: { difference: 0.08, significant: true },
    });
    expect(gain.action).toBe('advance');
  });
  it('ignores a guardrail where the stable arm is the worse one', () => {
    const decision = decideRollout(arms(500), {
      ...clean,
      guardrails: [{ metric: 'compliance', worse: 'stable' }],
    });
    expect(decision.action).toBe('advance');
  });
  it('holds without enough traffic on either arm, even when everything looks fine', () => {
    expect(decideRollout(arms(500), { ...clean, canarySessions: 99 })).toMatchObject({
      action: 'hold',
      reason: 'insufficient-sessions',
    });
    expect(decideRollout(arms(500), { ...clean, stableSessions: 5 }).action).toBe('hold');
    // Harm is acted on regardless of volume: always-valid p-values already require their own minimum.
    expect(
      decideRollout(arms(500), {
        ...clean,
        canarySessions: 10,
        guardrails: [{ metric: 'abandonment', worse: 'canary' }],
      }).action,
    ).toBe('rollback');
  });
  it('proposes the next stage and keeps weights summing to 10000 along the whole ladder', () => {
    let weight: number = STAGES[0];
    const seen: number[] = [weight];
    for (let i = 0; i < 6; i += 1) {
      const decision = decideRollout(arms(weight), clean);
      if (decision.action !== 'advance') break;
      const total = decision.proposal?.reduce((sum, x) => sum + x.weight, 0);
      expect(total).toBe(10_000);
      weight = decision.to ?? weight;
      seen.push(weight);
    }
    expect(seen).toEqual([500, 2500, 5000, 10_000]);
  });
});

describe('startProposal', () => {
  it('starts at the first stage and pins both versions', () => {
    expect(startProposal(v1, v2)).toEqual(arms(STAGES[0]));
    expect(startProposal(undefined, v2)[0]).not.toHaveProperty('pinnedVersionId');
  });
});

describe('evidenceOf', () => {
  const dashboard = (a: string, b: string, difference: number, worse: string | null) => ({
    variants: [
      { key: 'stable', experimentId: 'e', sessions: 300 },
      { key: 'canary', experimentId: 'e', sessions: 120 },
      { key: 'other', experimentId: 'x', sessions: 999 },
    ] as never,
    comparisons: [
      {
        experimentId: 'e',
        a,
        b,
        difference,
        pValue: 0.01,
        significant: true,
        reason: 'sufficient' as const,
        anytimePValue: 0.01,
        anytimeSignificant: true,
      },
    ],
    guardrails: [
      {
        experimentId: 'e',
        a,
        b,
        metric: 'abandonment' as const,
        difference: 0.2,
        pValue: 0.001,
        worse,
      },
      {
        experimentId: 'x',
        a,
        b,
        metric: 'compliance' as const,
        difference: 0.2,
        pValue: 0.001,
        worse: b,
      },
    ],
  });
  it('normalises the sign so differences always read canary minus stable', () => {
    expect(evidenceOf(dashboard('stable', 'canary', -0.1, 'canary'), 'e')).toMatchObject({
      stableSessions: 300,
      canarySessions: 120,
      primary: { difference: -0.1, significant: true },
      guardrails: [{ metric: 'abandonment', worse: 'canary' }],
    });
    expect(evidenceOf(dashboard('canary', 'stable', 0.1, 'canary'), 'e').primary?.difference).toBe(
      -0.1,
    );
  });
  it('ignores other experiments and returns empty evidence when no comparison exists', () => {
    const none = evidenceOf({ variants: [], comparisons: [], guardrails: [] }, 'e');
    expect(none).toEqual({ stableSessions: 0, canarySessions: 0, primary: null, guardrails: [] });
    expect(evidenceOf(dashboard('stable', 'canary', 0, null), 'e').guardrails).toHaveLength(1);
  });
});
