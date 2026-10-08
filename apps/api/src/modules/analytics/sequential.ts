/**
 * Sequential (always-valid) A/B inference, ADR-0048.
 *
 * `msprtProportions` is the normal-mixture mixture sequential probability ratio test of
 * Johari et al. (2017) for a difference of two proportions. Its likelihood ratio is a
 * non-negative martingale under the null, so `min(1, 1/Λ)` is a valid p-value at ANY data-dependent
 * stopping time: looking at the dashboard every minute cannot inflate the false-positive rate.
 * The statistic is recomputed from the current counts (stateless), which makes it slightly more
 * conservative than the running minimum over history; it is never anti-conservative.
 */
export interface Arm {
  readonly sessions: number;
  readonly completed: number;
}
export interface SequentialOptions {
  /** Prior standard deviation of the true difference (absolute, 0..1). */
  readonly tau: number;
  readonly alpha: number;
  /** Minimum sessions per arm before any verdict. */
  readonly minSessions: number;
}
export const DEFAULT_SEQUENTIAL: SequentialOptions = { tau: 0.05, alpha: 0.05, minSessions: 30 };

export interface SequentialResult {
  readonly difference: number;
  readonly logLikelihoodRatio: number | null;
  readonly pValue: number | null;
  readonly significant: boolean;
  readonly reason: 'sufficient' | 'insufficient';
}

const valid = (a: Arm): boolean =>
  Number.isSafeInteger(a.sessions) &&
  Number.isSafeInteger(a.completed) &&
  a.sessions > 0 &&
  a.completed >= 0 &&
  a.completed <= a.sessions;

export function msprtProportions(
  a: Arm,
  b: Arm,
  options: SequentialOptions = DEFAULT_SEQUENTIAL,
): SequentialResult {
  const insufficient = (difference: number): SequentialResult => ({
    difference,
    logLikelihoodRatio: null,
    pValue: null,
    significant: false,
    reason: 'insufficient',
  });
  if (!valid(a) || !valid(b)) return insufficient(0);
  const difference = b.completed / b.sessions - a.completed / a.sessions;
  if (Math.min(a.sessions, b.sessions) < options.minSessions) return insufficient(difference);
  const pooled = (a.completed + b.completed) / (a.sessions + b.sessions),
    // Variance floor keeps an all-zero / all-one cohort from dividing by zero.
    variance = Math.max(pooled * (1 - pooled), 1e-6),
    n = 2 / (1 / a.sessions + 1 / b.sessions),
    tau2 = options.tau * options.tau,
    denominator = 2 * variance + n * tau2,
    logLambda =
      0.5 * Math.log((2 * variance) / denominator) +
      (n * n * tau2 * difference * difference) / (4 * variance * denominator);
  const pValue = Math.min(1, Math.exp(-logLambda));
  return {
    difference,
    logLikelihoodRatio: logLambda,
    pValue,
    significant: pValue < options.alpha,
    reason: 'sufficient',
  };
}

export interface CupedResult {
  readonly adjusted: number[];
  readonly theta: number;
  /** 1 - Var(adjusted)/Var(y); 0 when the covariate carries no information. */
  readonly varianceReduction: number;
}
const avg = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
const variance = (v: readonly number[], m: number): number =>
  v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);

/**
 * CUPED (Deng et al. 2013): `y' = y - θ (x - mean(x))` with θ = cov(x, y) / var(x), where `x` is a
 * PRE-experiment covariate (the agent's previous-period mean). Because x is measured before
 * assignment, the adjustment does not bias the treatment-effect estimate. θ is estimated on the
 * pooled data of both arms so it cannot depend on the assigned arm.
 */
export function cuped(y: readonly number[], x: readonly number[]): CupedResult {
  if (y.length !== x.length || y.length < 3 || ![...y, ...x].every(Number.isFinite))
    return { adjusted: [...y], theta: 0, varianceReduction: 0 };
  const my = avg(y),
    mx = avg(x),
    vx = variance(x, mx);
  if (vx === 0) return { adjusted: [...y], theta: 0, varianceReduction: 0 };
  const cov = y.reduce((s, v, i) => s + (v - my) * ((x[i] ?? 0) - mx), 0) / (y.length - 1),
    theta = cov / vx,
    adjusted = y.map((v, i) => v - theta * ((x[i] ?? 0) - mx)),
    vy = variance(y, my);
  return {
    adjusted,
    theta,
    varianceReduction: vy === 0 ? 0 : Math.max(0, 1 - variance(adjusted, avg(adjusted)) / vy),
  };
}
