import { z } from 'zod';

export const ReleaseScheduleSchema = z
  .strictObject({ at: z.iso.datetime({ offset: true }) })
  .meta({ id: 'ReleaseSchedule' });
export const RollbackSchema = z
  .strictObject({ targetNumber: z.number().int().positive(), expectedCurrentVersionId: z.uuid() })
  .meta({ id: 'RollbackRelease' });
export const CommentInputSchema = z
  .strictObject({
    nodeId: z.string().max(128),
    text: z.string().trim().min(1).max(4000),
    mentions: z.array(z.uuid()).max(20).default([]),
  })
  .meta({ id: 'NodeCommentInput' });
export const CommentReplySchema = CommentInputSchema.omit({ nodeId: true }).meta({
  id: 'NodeCommentReply',
});
export const ThreadSchema = z
  .object({
    id: z.uuid(),
    nodeId: z.string(),
    resolved: z.boolean(),
    messages: z
      .array(
        z.object({
          id: z.uuid(),
          author: z.string(),
          text: z.string(),
          mentions: z.array(z.uuid()),
          createdAt: z.string(),
        }),
      )
      .max(500),
    version: z.number().int(),
  })
  .meta({ id: 'NodeCommentThread' });
export const ResolveThreadSchema = z
  .strictObject({ resolved: z.boolean(), version: z.number().int().positive() })
  .meta({ id: 'ResolveCommentThread' });
export const CollaborationTicketSchema = z
  .object({
    ticket: z.string(),
    documentName: z.string(),
    userId: z.uuid(),
    path: z.literal('/collaboration'),
  })
  .meta({ id: 'CollaborationTicket' });
export const NotificationSchema = z
  .object({
    id: z.string(),
    scriptId: z.uuid(),
    number: z.number().int(),
    kind: z.enum(['review', 'mention']),
    createdAt: z.string(),
    threadId: z.uuid().optional(),
  })
  .meta({ id: 'AuthoringNotification' });
export const PackageImportRequestSchema = z
  .strictObject({
    package: z.record(z.string(), z.unknown()),
    integrationMappings: z
      .record(
        z.string(),
        z.strictObject({
          key: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
          version: z.number().int().positive(),
        }),
      )
      .default({}),
    secretMappings: z.record(z.uuid(), z.uuid()).default({}),
  })
  .meta({ id: 'PackageImportRequest' });
