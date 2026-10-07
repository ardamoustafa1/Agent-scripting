import { z } from 'zod';

export const RolloutReportSchema = z
  .object({
    assignmentId: z.uuid(),
    stableSessions: z.number().int(),
    canarySessions: z.number().int(),
    windowDays: z.number().int(),
    decision: z.object({
      action: z.enum(['none', 'hold', 'advance', 'rollback']),
      reason: z.enum([
        'not-a-rollout',
        'not-started',
        'complete',
        'guardrail-breached',
        'completion-dropped',
        'insufficient-sessions',
        'no-harm-detected',
      ]),
      breached: z.array(z.string()),
      from: z.number().int().nullable(),
      to: z.number().int().nullable(),
      proposal: z
        .array(
          z.object({
            key: z.string(),
            weight: z.number().int(),
            pinnedVersionId: z.uuid().optional(),
          }),
        )
        .optional(),
    }),
  })
  .meta({ id: 'RolloutReport' });

export const AllocationReportSchema = z
  .object({
    assignmentId: z.uuid(),
    allocation: z.object({
      reason: z.enum(['ok', 'insufficient-sessions', 'no-eligible-arm']),
      arms: z.array(
        z.object({
          key: z.string(),
          probabilityBest: z.number(),
          weight: z.number().int(),
        }),
      ),
    }),
  })
  .meta({ id: 'AllocationReport' });
