import { z } from 'zod';

import { IsoDateTime, ResourceMetaShape, UuidSchema, iso, isoOrNull } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

import type { ScriptRow, VersionSummaryRow } from './scripts.repository.js';

export const ScriptStatusSchema = z.enum(['draft', 'active', 'archived']);
const Tags = z.array(z.string().trim().min(1).max(40)).max(20);

export const ScriptSchema = z
  .object({
    ...ResourceMetaShape,
    name: z.string(),
    description: z.string().nullable(),
    status: ScriptStatusSchema,
    tags: z.array(z.string()),
    currentVersionId: UuidSchema.nullable(),
  })
  .meta({ id: 'Script' });
export type ScriptDto = z.infer<typeof ScriptSchema>;

export const CreateScriptSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    tags: Tags.default([]),
    /** Atomically bind a new script to a campaign; required for campaign-scoped authors. */
    campaignId: UuidSchema.optional(),
  })
  .meta({ id: 'CreateScript' });
export type CreateScriptInput = z.output<typeof CreateScriptSchema>;

export const UpdateScriptSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    tags: Tags.optional(),
    status: ScriptStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required')
  .meta({ id: 'UpdateScript' });
export type UpdateScriptInput = z.output<typeof UpdateScriptSchema>;

export const ScriptListQuerySchema = listQuerySchema(['createdAt', 'updatedAt', 'name'], {
  status: ScriptStatusSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ScriptListQuery = z.output<typeof ScriptListQuerySchema>;
export const ScriptPageSchema = pageSchema(ScriptSchema).meta({ id: 'ScriptPage' });

export const ScreenUseSchema = z.strictObject({
  sharedScreenId: UuidSchema,
  /** Shared-screen version number; latest when omitted. */
  versionNumber: z.number().int().positive().optional(),
  mode: z.enum(['linked', 'detached']).default('linked'),
});

export const CreateVersionSchema = z
  .strictObject({
    /** Validated with @verbis/script-schema (older schemaVersions are migrated first). */
    document: z.record(z.string(), z.unknown()),
    /** Shared screens composed into the document (linked pages are re-materialized). */
    screens: z.array(ScreenUseSchema).max(50).default([]),
  })
  .meta({ id: 'CreateScriptVersion' });
export type CreateVersionInput = z.output<typeof CreateVersionSchema>;

export const ValidationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  path: z.string(),
  code: z.string(),
  messageKey: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const ScriptVersionSummarySchema = z
  .object({
    ...ResourceMetaShape,
    scriptId: UuidSchema,
    number: z.number().int().positive(),
    state: z.enum(['draft', 'in_review', 'approved', 'published', 'retired']),
    schemaVersion: z.string(),
    documentEncoding: z.enum(['json', 'gzip']),
    documentSize: z.number().int(),
    checksum: z.string(),
    publishedAt: IsoDateTime.nullable(),
    semver: z.string().nullable(),
    changeNote: z.string().nullable(),
    submittedAt: IsoDateTime.nullable(),
    approvedAt: IsoDateTime.nullable(),
    retiredAt: IsoDateTime.nullable(),
    reviewRound: z.number().int(),
    createdBy: z.string(),
    /** Branch label; null on the mainline (ADR-0051). */
    branch: z.string().nullable(),
  })
  .meta({ id: 'ScriptVersionSummary' });
export type ScriptVersionSummaryDto = z.infer<typeof ScriptVersionSummarySchema>;

export const CreatedVersionSchema = ScriptVersionSummarySchema.extend({
  migratedFrom: z.array(z.string()),
  warnings: z.array(ValidationIssueSchema),
}).meta({ id: 'CreatedScriptVersion' });

export const ScriptVersionSchema = ScriptVersionSummarySchema.extend({
  screens: z.array(
    z.object({
      sharedScreenId: z.uuid(),
      versionNumber: z.number().int(),
      mode: z.enum(['linked', 'detached']),
      pageIds: z.array(z.string()),
    }),
  ),
  document: z.record(z.string(), z.unknown()),
}).meta({ id: 'ScriptVersion' });

export const VersionListQuerySchema = listQuerySchema(['number'], {});
export type VersionListQuery = z.output<typeof VersionListQuerySchema>;
export const VersionPageSchema = pageSchema(ScriptVersionSummarySchema).meta({
  id: 'ScriptVersionPage',
});

export function toScriptDto(row: ScriptRow): ScriptDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    tags: row.tags,
    currentVersionId: row.currentVersionId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}

export function toVersionSummaryDto(row: VersionSummaryRow): ScriptVersionSummaryDto {
  return {
    id: row.id,
    scriptId: row.scriptId,
    number: row.number,
    state: row.state,
    schemaVersion: row.schemaVersion,
    documentEncoding: row.documentEncoding,
    documentSize: row.documentSize,
    checksum: row.checksum,
    publishedAt: isoOrNull(row.publishedAt),
    semver: row.semver,
    changeNote: row.changeNote,
    submittedAt: isoOrNull(row.submittedAt),
    approvedAt: isoOrNull(row.approvedAt),
    retiredAt: isoOrNull(row.retiredAt),
    reviewRound: row.reviewRound,
    createdBy: row.createdBy,
    branch: row.branch,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
const Semver = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/,
    'semantic version like 1.4.0',
  );

export const SubmitVersionSchema = z
  .strictObject({
    semver: Semver,
    changeNote: z.string().trim().min(1).max(4000),
  })
  .meta({ id: 'SubmitScriptVersion' });
export type SubmitVersionInput = z.output<typeof SubmitVersionSchema>;

export const ReviewVersionSchema = z
  .discriminatedUnion('decision', [
    z.strictObject({
      decision: z.literal('approved'),
      comment: z.string().trim().max(4000).optional(),
    }),
    z.strictObject({
      decision: z.literal('rejected'),
      reason: z.string().trim().min(1).max(2000),
      comment: z.string().trim().max(4000).optional(),
    }),
    z.strictObject({
      decision: z.literal('commented'),
      comment: z.string().trim().min(1).max(4000),
    }),
  ])
  .meta({ id: 'ReviewScriptVersion' });
export type ReviewVersionInput = z.output<typeof ReviewVersionSchema>;

export const UpdateDraftSchema = CreateVersionSchema.meta({ id: 'UpdateScriptDraft' });

export const ReviewSchema = z
  .object({
    id: UuidSchema,
    round: z.number().int(),
    reviewer: z.string(),
    decision: z.enum(['approved', 'rejected', 'commented']),
    comment: z.string().nullable(),
    reason: z.string().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'ScriptVersionReview' });

export const VersionDiffSchema = z
  .object({
    from: z.object({
      number: z.number().int(),
      semver: z.string().nullable(),
      checksum: z.string(),
    }),
    to: z.object({ number: z.number().int(), semver: z.string().nullable(), checksum: z.string() }),
    patch: z.array(
      z.object({
        op: z.enum(['add', 'remove', 'replace']),
        path: z.string(),
        value: z.unknown().optional(),
      }),
    ),
    summary: z.object({ lines: z.array(z.string()), totalChanges: z.number().int() }).loose(),
  })
  .meta({ id: 'ScriptVersionDiff' });

const VersionNumberField = z.number().int().min(1).max(1_000_000);
export const MergePreviewRequestSchema = z
  .strictObject({ base: VersionNumberField, ours: VersionNumberField, theirs: VersionNumberField })
  .refine(
    (v) => new Set([v.base, v.ours, v.theirs]).size === 3,
    'base, ours and theirs must be three different versions',
  )
  .meta({ id: 'MergePreviewRequest' });
export const MergePreviewSchema = z
  .object({
    base: z.number().int(),
    ours: z.number().int(),
    theirs: z.number().int(),
    conflicts: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(['both-changed', 'deleted-vs-changed', 'duplicate-id']),
        base: z.unknown(),
        ours: z.unknown(),
        theirs: z.unknown(),
      }),
    ),
    issues: z.array(z.string()),
    document: z.unknown().nullable(),
  })
  .meta({ id: 'MergePreview' });

// ─── Branches (ADR-0051) ──────────────────────────────────────────────────────
export const BranchSchema = z
  .object({
    name: z.string(),
    versionNumber: z.number().int().positive(),
    parentNumber: z.number().int(),
    state: z.string(),
    createdAt: IsoDateTime,
    createdBy: z.string(),
    mergedInto: z.number().int().nullable(),
  })
  .meta({ id: 'ScriptBranch' });
export const CreateBranchSchema = z
  .strictObject({
    name: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case words separated by hyphens'),
    fromNumber: z.number().int().positive(),
  })
  .meta({ id: 'CreateBranch' });
export const BranchMergePreviewSchema = z
  .object({
    branch: z.string(),
    baseNumber: z.number().int(),
    mainlineNumber: z.number().int(),
    branchNumber: z.number().int(),
    conflicts: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(['both-changed', 'deleted-vs-changed', 'duplicate-id']),
        base: z.unknown(),
        ours: z.unknown(),
        theirs: z.unknown(),
      }),
    ),
    issues: z.array(z.string()),
    canMerge: z.boolean(),
  })
  .meta({ id: 'BranchMergePreview' });
