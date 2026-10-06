import { z } from 'zod';

export const OutboxStatusSchema = z
  .object({
    pending: z.number().int(),
    published: z.number().int(),
    dead: z.number().int(),
    oldestPendingAt: z.iso.datetime({ offset: true }).nullable(),
    deadEvents: z.array(
      z.object({
        id: z.uuid(),
        eventType: z.string(),
        attempts: z.number().int(),
        lastError: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'OutboxStatus' });
export type OutboxStatusDto = z.infer<typeof OutboxStatusSchema>;

export const RequeueResultSchema = z
  .object({ requeued: z.boolean() })
  .meta({ id: 'RequeueResult' });
