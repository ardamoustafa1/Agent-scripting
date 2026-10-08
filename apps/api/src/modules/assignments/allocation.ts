import type { AnalyticsDashboard } from '@verbis/shared-types';

/**
 * Multi-armed bandit traffic ADVICE (DIFFERENTIATORS F3): Thompson sampling over Beta posteriors of
 * the completion rate. It only proposes weights; applying them is a normal assignment PATCH, so
 * a person (or the caller's own automation) stays in control. Deterministic: the random stream is
 * seeded from the assignment id and the counts, so the same data always gives the same advice.
 */
export const MIN_WEIGHT = 500;
export const DRAWS = 4000;
export const MIN_ARM_SESSIONS = 50;

export interface ArmStats {
  readonly key: string;
  readonly sessions: number;
  readonly completed: number;
  /** A guardrail says this arm is significantly worse: it gets no traffic. */
  readonly breached: boolean;
}
export interface ArmAdvice {
  readonly key: string;
  readonly probabilityBest: number;
  /** Basis points; sums to exactly 10 000 across arms. */
  readonly weight: number;
}
export interface Allocation {
  readonly reason: 'ok' | 'insufficient-sessions' | 'no-eligible-arm';
  readonly arms: readonly ArmAdvice[];
}

export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (next: () => number): number => {
  const u = Math.max(next(), Number.MIN_VALUE),
    v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
/** Marsaglia–Tsang gamma sampler (shape ≥ 1 after the standard boost for shape < 1). */
function gamma(shape: number, next: () => number): number {
  if (shape < 1)
    return gamma(shape + 1, next) * Math.pow(Math.max(next(), Number.MIN_VALUE), 1 / shape);
  const d = shape - 1 / 3,
    c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(next),
      v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = Math.max(next(), Number.MIN_VALUE);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
const beta = (a: number, b: number, next: () => number): number => {
  const x = gamma(a, next);
  return x / (x + gamma(b, next));
};

export function advise(arms: readonly ArmStats[], seed: string): Allocation {
  const eligible = arms.filter((a) => !a.breached);
  if (eligible.length === 0) return { reason: 'no-eligible-arm', arms: [] };
  if (eligible.some((a) => a.sessions < MIN_ARM_SESSIONS))
    return { reason: 'insufficient-sessions', arms: [] };
  const next = seeded(
    `${seed}:${arms.map((a) => `${a.key}=${String(a.completed)}/${String(a.sessions)}`).join(',')}`,
  );
  const wins = new Map(eligible.map((a) => [a.key, 0]));
  for (let i = 0; i < DRAWS; i += 1) {
    let best = eligible[0]?.key ?? '',
      top = -1;
    for (const arm of eligible) {
      const draw = beta(1 + arm.completed, 1 + arm.sessions - arm.completed, next);
      if (draw > top) {
        top = draw;
        best = arm.key;
      }
    }
    wins.set(best, (wins.get(best) ?? 0) + 1);
  }
  // Exploration floor first, the remainder proportional to P(best); largest-remainder rounding.
  const spare = 10_000 - MIN_WEIGHT * eligible.length;
  const raw = eligible.map((arm) => {
    const probability = (wins.get(arm.key) ?? 0) / DRAWS,
      exact = MIN_WEIGHT + spare * probability;
    return { arm, probability, exact, weight: Math.floor(exact) };
  });
  let left = 10_000 - raw.reduce((sum, r) => sum + r.weight, 0);
  for (const r of [...raw].sort(
    (a, b) =>
      b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) ||
      a.arm.key.localeCompare(b.arm.key),
  )) {
    if (left <= 0) break;
    r.weight += 1;
    left -= 1;
  }
  const byKey = new Map(raw.map((r) => [r.arm.key, r]));
  return {
    reason: 'ok',
    arms: arms.map((arm) => ({
      key: arm.key,
      probabilityBest: byKey.get(arm.key)?.probability ?? 0,
      weight: byKey.get(arm.key)?.weight ?? 0,
    })),
  };
}

/** Arm statistics of one experiment out of an aggregated dashboard. */
export function armsOf(
  dashboard: Pick<AnalyticsDashboard, 'variants' | 'guardrails'>,
  experimentId: string,
  keys: readonly string[],
): ArmStats[] {
  const worse = new Set(
    (dashboard.guardrails ?? [])
      .filter((g) => g.experimentId === experimentId && g.worse !== null)
      .map((g) => g.worse),
  );
  return keys.map((key) => {
    const row = dashboard.variants.find((v) => v.experimentId === experimentId && v.key === key);
    return {
      key,
      sessions: row?.sessions ?? 0,
      completed: row?.completed ?? 0,
      breached: worse.has(key),
    };
  });
}
