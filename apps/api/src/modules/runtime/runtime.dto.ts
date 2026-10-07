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
    desktopLabel: z.object({ channel: z.string(), customerName: z.string().nullable() }).optional(),
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
  scriptVersionId: UuidSchema.optional(),
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

/** Session path replay (ADR-0050, metadata-only). */
export const ReplayStepSchema = z.discriminatedUnion('kind', [
  z.object({
    seq: z.number().int(),
    atMs: z.number().int(),
    kind: z.literal('page'),
    pageId: z.string(),
    pageName: z.string().nullable(),
  }),
  z.object({
    seq: z.number().int(),
    atMs: z.number().int(),
    kind: z.literal('field'),
    variable: z.string(),
    value: z.string(),
  }),
  z.object({
    seq: z.number().int(),
    atMs: z.number().int(),
    kind: z.literal('state'),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    seq: z.number().int(),
    atMs: z.number().int(),
    kind: z.literal('timer'),
    timerId: z.string(),
  }),
  z.object({
    seq: z.number().int(),
    atMs: z.number().int(),
    kind: z.literal('other'),
    type: z.string(),
  }),
]);
export const SessionReplaySchema = z
  .object({
    sessionId: UuidSchema,
    scriptId: UuidSchema,
    versionNumber: z.number().int(),
    state: SessionStateSchema,
    startedAt: IsoDateTime,
    durationMs: z.number().int(),
    steps: z.array(ReplayStepSchema),
    pages: z.array(
      z.object({
        pageId: z.string(),
        name: z.string(),
        visits: z.number().int(),
        dwellMs: z.number().int(),
      }),
    ),
    unreached: z.array(z.object({ id: z.string(), name: z.string() })),
    truncated: z.boolean(),
  })
  .meta({ id: 'SessionReplay' });
export type SessionReplayDto = z.infer<typeof SessionReplaySchema>;
