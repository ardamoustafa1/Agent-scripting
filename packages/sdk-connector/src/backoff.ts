/**
 * Exponential backoff with full jitter (reconnects, retries). `random` is injectable so tests are
 * deterministic.
 */
export interface BackoffOptions {
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly random?: () => number;
}

export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 60_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, Math.min(attempt, 30)));
  return Math.floor(random() * ceiling);
}
