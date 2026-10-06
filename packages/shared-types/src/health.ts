import { z } from 'zod';

export const HealthCheckResultSchema = z.object({
  status: z.enum(['up', 'down']),
  detail: z.string().optional(),
});

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  checks: z.record(z.string(), HealthCheckResultSchema),
});

export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/** Aggregates individual checks: all up → ok, otherwise error. */
export function aggregateHealth(
  service: string,
  version: string,
  checks: Record<string, HealthCheckResult>,
): HealthStatus {
  const allUp = Object.values(checks).every((check) => check.status === 'up');
  return { status: allUp ? 'ok' : 'error', service, version, checks };
}
