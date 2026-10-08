import { describe, expect, it } from 'vitest';

import { cuped, msprtProportions } from './sequential.js';

/** Deterministic LCG so the simulation is reproducible (CLAUDE.md §8). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('msprtProportions', () => {
  it('refuses verdicts on small or invalid arms', () => {
    expect(
      msprtProportions({ sessions: 10, completed: 5 }, { sessions: 500, completed: 400 }),
    ).toMatchObject({ pValue: null, significant: false, reason: 'insufficient' });
    expect(
      msprtProportions({ sessions: 0, completed: 0 }, { sessions: 50, completed: 5 }).reason,
    ).toBe('insufficient');
    expect(
      msprtProportions({ sessions: 50, completed: 60 }, { sessions: 50, completed: 5 }).reason,
    ).toBe('insufficient');
  });
  it('detects a large effect and ignores an identical split', () => {
    const effect = msprtProportions(
      { sessions: 400, completed: 120 },
      { sessions: 400, completed: 180 },
    );
    expect(effect.significant).toBe(true);
    expect(effect.pValue).toBeLessThan(0.01);
    const same = msprtProportions(
      { sessions: 400, completed: 120 },
      { sessions: 400, completed: 120 },
    );
    expect(same.significant).toBe(false);
    expect(same.pValue).toBe(1);
  });
  it('is symmetric in the arms and bounded by 1', () => {
    const ab = msprtProportions(
      { sessions: 300, completed: 100 },
      { sessions: 320, completed: 130 },
    );
    const ba = msprtProportions(
      { sessions: 320, completed: 130 },
      { sessions: 300, completed: 100 },
    );
    expect(ab.pValue).toBeCloseTo(ba.pValue ?? NaN, 12);
    expect(ab.difference).toBeCloseTo(-ba.difference, 12);
    expect(ab.pValue).toBeLessThanOrEqual(1);
  });
  it('handles all-zero and all-one cohorts without NaN', () => {
    const r = msprtProportions({ sessions: 100, completed: 0 }, { sessions: 100, completed: 100 });
    expect(Number.isFinite(r.logLikelihoodRatio)).toBe(true);
    expect(r.significant).toBe(true);
  });
  it('keeps the false-positive rate near alpha under continuous peeking (A/A simulation)', () => {
    const trials = 400,
      steps = 40,
      batch = 25;
    let falsePositives = 0,
      fixedHorizonPeeks = 0;
    for (let t = 0; t < trials; t++) {
      const next = rng(1000 + t);
      let a = 0,
        b = 0,
        n = 0,
        flagged = false,
        naive = false;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < batch; i++) {
          if (next() < 0.3) a++;
          if (next() < 0.3) b++;
        }
        n += batch;
        if (
          n >= 30 &&
          msprtProportions({ sessions: n, completed: a }, { sessions: n, completed: b }).significant
        )
          flagged = true;
        // Naive pooled z-test applied at every look, for contrast.
        const p = (a + b) / (2 * n),
          se = Math.sqrt(p * (1 - p) * (2 / n));
        if (se > 0 && Math.abs((b - a) / n / se) > 1.96) naive = true;
      }
      if (flagged) falsePositives++;
      if (naive) fixedHorizonPeeks++;
    }
    expect(falsePositives / trials).toBeLessThanOrEqual(0.05);
    // Documents WHY the sequential test exists: naive peeking inflates errors well past 5%.
    expect(fixedHorizonPeeks / trials).toBeGreaterThan(0.1);
  });
});

describe('cuped', () => {
  it('removes variance explained by the pre-period covariate without shifting the mean', () => {
    const next = rng(7);
    const x = Array.from({ length: 500 }, () => next() * 100);
    const y = x.map((v) => 2 * v + (next() - 0.5) * 10);
    const result = cuped(y, x);
    expect(result.theta).toBeCloseTo(2, 1);
    expect(result.varianceReduction).toBeGreaterThan(0.95);
    const mean = (v: number[]) => v.reduce((s, q) => s + q, 0) / v.length;
    expect(mean(result.adjusted)).toBeCloseTo(mean(y), 8);
  });
  it('is a no-op for uninformative or degenerate input', () => {
    expect(cuped([1, 2, 3], [5, 5, 5])).toMatchObject({ theta: 0, varianceReduction: 0 });
    expect(cuped([1, 2], [1, 2]).theta).toBe(0);
    expect(cuped([1, 2, 3], [1, 2]).adjusted).toEqual([1, 2, 3]);
    expect(cuped([1, Number.NaN, 3], [1, 2, 3]).theta).toBe(0);
  });
});
