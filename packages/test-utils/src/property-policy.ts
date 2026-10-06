/** Security property suites must not silently run fewer generated cases. */
export const MIN_SECURITY_PROPERTY_RUNS = 1000;
export function securityPropertyOptions(seed: number, numRuns = MIN_SECURITY_PROPERTY_RUNS) {
  if (!Number.isSafeInteger(seed)) throw new Error('A deterministic integer seed is required');
  if (!Number.isSafeInteger(numRuns) || numRuns < MIN_SECURITY_PROPERTY_RUNS)
    throw new Error(`Security properties require at least ${MIN_SECURITY_PROPERTY_RUNS} runs`);
  return Object.freeze({ seed, numRuns });
}
