import { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

type EnvSource = Record<string, string | undefined>;

/** Isomorphic access to process.env (this package is also used in browser bundles). */
function processEnv(): EnvSource {
  return (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};
}

/**
 * Validates environment variables against a zod schema.
 * Throws {@link EnvValidationError} listing every problem so a service never starts with bad config.
 * Values are never echoed back: only variable names and reasons (they may contain secrets).
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: EnvSource = processEnv(),
): z.infer<S> {
  const result = schema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}

/** Common building blocks for service env schemas. */
export const envSchemas = {
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().min(1).max(65535),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  url: z.url(),
  /** Accepts "true"/"false"/"1"/"0"; anything else is rejected. */
  boolean: z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1'),
} as const;
