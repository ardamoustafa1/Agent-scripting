import { z } from 'zod';

export const EventCountQuerySchema = z
  .strictObject({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    eventType: z.string().max(128).optional(),
  })
  .meta({ id: 'EventCountQuery' });
export type EventCountQuery = z.output<typeof EventCountQuerySchema>;

export const EventCountSchema = z.object({
  eventType: z.string(),
  day: z.iso.date(),
  count: z.number().int(),
});
export const EventCountsSchema = z
  .object({ data: z.array(EventCountSchema) })
  .meta({ id: 'EventCounts' });
export type EventCountsDto = z.infer<typeof EventCountsSchema>;
