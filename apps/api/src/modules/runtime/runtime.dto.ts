import { z } from 'zod';

import { IsoDateTime, ResourceMetaShape, UuidSchema, iso, isoOrNull } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

import type { SessionEventRow, SessionRow } from './runtime.repository.js';

export const SessionStateSchema = z.enum([
  'launching',
  'paused',
  'active',
  'wrapup',
  'completed',
  'abandoned',
  'expired',
]);

/** Variables are omitted from list/detail views; they may hold classified data. */
export const SessionSchema = z
  .object({
    ...ResourceMetaShape,
    interactionId: UuidSchema.nullable(),
    userId: UuidSchema,
    scriptVersionId: UuidSchema,
    assignmentId: UuidSchema.nullable(),
    state: SessionStateSchema,
    sequence: z.number().int().nonnegative(),
    startedAt: IsoDateTime,
    endedAt: IsoDateTime.nullable(),
    checksum: z.string(),
  })
  .meta({ id: 'Session' });
export type SessionDto = z.infer<typeof SessionSchema>;

export const SessionEventSchema = z
  .object({
    id: UuidSchema,
    seq: z.number().int(),
    type: z.string(),
    payload: z.unknown(),
    occurredAt: IsoDateTime,
  })
  .meta({ id: 'SessionEvent' });
export type SessionEventDto = z.infer<typeof SessionEventSchema>;

export const SessionListQuerySchema = listQuerySchema(['createdAt', 'startedAt'], {
  state: SessionStateSchema.optional(),
  userId: UuidSchema.optional(),
});
export type SessionListQuery = z.output<typeof SessionListQuerySchema>;
export const SessionEventListQuerySchema = listQuerySchema(['seq'], {}, 'seq');
export type SessionEventListQuery = z.output<typeof SessionEventListQuerySchema>;

export const SessionPageSchema = pageSchema(SessionSchema).meta({ id: 'SessionPage' });
export const SessionEventPageSchema = pageSchema(SessionEventSchema).meta({
  id: 'SessionEventPage',
});

export const toSessionDto = (row: SessionRow): SessionDto => ({
  id: row.id,
  interactionId: row.interactionId,
  userId: row.userId,
  scriptVersionId: row.scriptVersionId,
  assignmentId: row.assignmentId,
  state: row.state,
  sequence: row.sequence,
  startedAt: iso(row.startedAt),
  endedAt: isoOrNull(row.endedAt),
  checksum: row.checksum,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
});

export const toSessionEventDto = (row: SessionEventRow): SessionEventDto => ({
  id: row.id,
  seq: row.seq,
  type: row.type,
  payload: row.payload,
  occurredAt: iso(row.occurredAt),
});
