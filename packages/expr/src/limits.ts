/**
 * Evaluation budgets for the safe expression engine (ADR-0007).
 * Budgets are fixed at the platform ceiling so
 * every consumer shares the same limits from day one.
 */
export interface ExpressionLimits {
  readonly maxStringLength: number;
  readonly maxCollectionLength: number;
  readonly maxSourceLength: number;
  readonly maxAstDepth: number;
  readonly maxSteps: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_EXPRESSION_LIMITS: ExpressionLimits = Object.freeze({
  maxSourceLength: 2_000,
  maxStringLength: 16_384,
  maxCollectionLength: 1_000,
  maxAstDepth: 32,
  maxSteps: 10_000,
  maxOutputBytes: 64 * 1024,
  timeoutMs: 50,
});

/** Merges overrides, never allowing a limit above the platform default. */
export function resolveLimits(overrides: Partial<ExpressionLimits> = {}): ExpressionLimits {
  const clamp = (key: keyof ExpressionLimits): number => {
    const requested = overrides[key];
    const ceiling = DEFAULT_EXPRESSION_LIMITS[key];
    if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return ceiling;
    return Math.max(1, Math.floor(Math.min(requested, ceiling)));
  };
  return Object.freeze({
    maxSourceLength: clamp('maxSourceLength'),
    maxStringLength: clamp('maxStringLength'),
    maxCollectionLength: clamp('maxCollectionLength'),
    maxAstDepth: clamp('maxAstDepth'),
    maxSteps: clamp('maxSteps'),
    maxOutputBytes: clamp('maxOutputBytes'),
    timeoutMs: clamp('timeoutMs'),
  });
}
