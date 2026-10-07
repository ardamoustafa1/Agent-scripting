import { describe, expect, it } from 'vitest';

import { advise, armsOf, MIN_WEIGHT, seeded, type ArmStats } from './allocation.js';

const arm = (key: string, sessions: number, completed: number, breached = false): ArmStats => ({
  key,
  sessions,
  completed,
  breached,
});
const total = (weights: readonly { weight: number }[]) =>
  weights.reduce((sum, w) => sum + w.weight, 0);

describe('seeded', () => {
  it('is deterministic per seed and uniform in [0, 1)', () => {
    const a = seeded('x'),
      b = seeded('x'),
      c = seeded('y');
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(xs.reduce((s, v) => s + v, 0) / xs.length).toBeGreaterThan(0.45);
    expect(xs.reduce((s, v) => s + v, 0) / xs.length).toBeLessThan(0.55);
    expect(c()).not.toBe(seeded('x')());
  });
});

describe('advise', () => {
  it('moves traffic to the clearly better arm but keeps the exploration floor', () => {
    const result = advise([arm('a', 400, 120), arm('b', 400, 220)], 'e1');
    expect(result.reason).toBe('ok');
    const [a, b] = result.arms;
    expect(total(result.arms)).toBe(10_000);
    expect(b?.weight).toBeGreaterThan(9000);
    expect(a?.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
    expect(b?.probabilityBest).toBeGreaterThan(0.99);
  });
  it('splits roughly evenly when the arms are indistinguishable', () => {
    const result = advise([arm('a', 300, 100), arm('b', 300, 100)], 'e2');
    for (const w of result.arms) expect(Math.abs(w.weight - 5000)).toBeLessThan(1500);
    expect(total(result.arms)).toBe(10_000);
  });
  it('gives a breached arm no traffic and redistributes among the rest', () => {
    const result = advise([arm('a', 300, 90), arm('b', 300, 150, true), arm('c', 300, 100)], 'e3');
    expect(result.arms.find((w) => w.key === 'b')?.weight).toBe(0);
    expect(total(result.arms)).toBe(10_000);
    expect(result.arms.find((w) => w.key === 'c')?.weight).toBeGreaterThan(
      result.arms.find((w) => w.key === 'a')?.weight ?? 0,
    );
  });
  it('refuses to advise without enough data or without an eligible arm', () => {
    expect(advise([arm('a', 10, 5), arm('b', 400, 100)], 'e4')).toEqual({
      reason: 'insufficient-sessions',
      arms: [],
    });
    expect(advise([arm('a', 400, 5, true), arm('b', 400, 100, true)], 'e5').reason).toBe(
      'no-eligible-arm',
    );
  });
  it('is deterministic for the same data and changes when the data changes', () => {
    const data = [arm('a', 200, 80), arm('b', 200, 90)];
    expect(advise(data, 's')).toEqual(advise(data, 's'));
    expect(advise([arm('a', 200, 80), arm('b', 200, 91)], 's')).not.toEqual(advise(data, 's'));
  });
  it('always sums to exactly 10000 for any number of arms', () => {
    for (let n = 2; n <= 7; n += 1) {
      const arms = Array.from({ length: n }, (_, i) =>
        arm(`v${String(i)}`, 100 + i * 7, 30 + i * 3),
      );
      expect(total(advise(arms, `n${String(n)}`).arms)).toBe(10_000);
    }
  });
});

describe('armsOf', () => {
  it('marks only the arms a guardrail names as worse and defaults missing arms to zero', () => {
    const dashboard = {
      variants: [
        { experimentId: 'e', key: 'a', sessions: 100, completed: 40 },
        { experimentId: 'z', key: 'a', sessions: 999, completed: 999 },
      ] as never,
      guardrails: [
        {
          experimentId: 'e',
          a: 'a',
          b: 'b',
          metric: 'abandonment' as const,
          difference: 0.2,
          pValue: 0.001,
          worse: 'b',
        },
      ],
    };
    expect(armsOf(dashboard, 'e', ['a', 'b'])).toEqual([
      { key: 'a', sessions: 100, completed: 40, breached: false },
      { key: 'b', sessions: 0, completed: 0, breached: true },
    ]);
  });
});
