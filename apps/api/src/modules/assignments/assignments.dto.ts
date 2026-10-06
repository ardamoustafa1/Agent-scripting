import { z } from 'zod';

import { PredicateLeafSchema, type Predicate } from '@verbis/script-schema';

import {
  ChannelTypeSchema,
  IsoDateTime,
  ResourceMetaShape,
  UuidSchema,
  iso,
  isoOrNull,
} from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';
import { VariantsSchema, type Variant } from '../routing/domain/ab.js';
import { routingPredicateIssues } from '../routing/domain/predicate.js';

import type { AssignmentRow } from './assignments.repository.js';
import type { AssignmentConditions } from '../routing/domain/resolver.js';

const Values = z.array(z.string().trim().min(1).max(128)).max(100);
const unique = (items: readonly string[]) => new Set(items).size === items.length;

/** Context filters; an empty or absent list means "any". */
export const AssignmentConditionsSchema = z
  .strictObject({
    channels: z.array(ChannelTypeSchema).max(8).refine(unique, 'duplicate channel').optional(),
    locales: z
      .array(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/))
      .max(20)
      .refine(unique, 'duplicate locale')
      .optional(),
    queues: Values.refine(unique, 'duplicate queue').optional(),
    skills: Values.refine(unique, 'duplicate skill').optional(),
    segments: Values.refine(unique, 'duplicate segment').optional(),
  })
  .meta({ id: 'AssignmentConditions' });

export const VersionPolicySchema = z.enum(['pinned', 'latestPublished']);

export const AssignmentSchema = z
  .object({
    ...ResourceMetaShape,
    scriptId: UuidSchema,
    campaignId: UuidSchema,
    priority: z.number().int(),
    versionPolicy: VersionPolicySchema,
    pinnedVersionId: UuidSchema.nullable(),
    effectiveFrom: IsoDateTime.nullable(),
    effectiveTo: IsoDateTime.nullable(),
    conditions: AssignmentConditionsSchema,
    expression: z.unknown().nullable(),
    variants: z
      .array(
        z.object({
          key: z.string(),
          weight: z.number().int(),
          pinnedVersionId: UuidSchema.optional(),
        }),
      )
      .nullable(),
    /** @deprecated aliases (prompt 3) */
    validFrom: IsoDateTime.nullable(),
    validTo: IsoDateTime.nullable(),
    rule: z.unknown().nullable(),
  })
  .meta({ id: 'Assignment' });
export type AssignmentDto = z.infer<typeof AssignmentSchema>;

const window = (v: {
  effectiveFrom?: string | null | undefined;
  effectiveTo?: string | null | undefined;
}) =>
  v.effectiveFrom === undefined ||
  v.effectiveFrom === null ||
  v.effectiveTo === undefined ||
  v.effectiveTo === null ||
  new Date(v.effectiveTo) > new Date(v.effectiveFrom);

/** Routing deliberately excludes expression references from the public write contract. */
const RoutingPredicateSchema: z.ZodType<Predicate> = z
  .lazy(() =>
    z.union([
      z.strictObject({ all: z.array(RoutingPredicateSchema).min(1).max(1000) }),
      z.strictObject({ any: z.array(RoutingPredicateSchema).min(1).max(1000) }),
      z.strictObject({ not: RoutingPredicateSchema }),
      PredicateLeafSchema,
    ]),
  )
  .meta({ id: 'RoutingPredicate' });

const Fields = {
  priority: z.number().int().min(0).max(10_000),
  versionPolicy: VersionPolicySchema,
  pinnedVersionId: UuidSchema.nullable(),
  effectiveFrom: IsoDateTime.nullable(),
  effectiveTo: IsoDateTime.nullable(),
  conditions: AssignmentConditionsSchema,
  /** No-code predicate (SCRIPT_MODEL §6) over interaction/agent/campaign facts. */
  expression: RoutingPredicateSchema.superRefine((predicate, ctx) => {
    for (const issue of routingPredicateIssues(predicate))
      ctx.addIssue({ code: 'custom', ...issue });
  }).nullable(),
  variants: VariantsSchema.nullable(),
};

/** Accepts the prompt-3 names (`validFrom`, `validTo`, `rule`) as aliases. */
function normalizeAliases(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const { validFrom, validTo, rule, ...rest } = raw as Record<string, unknown>;
  return {
    ...rest,
    ...(validFrom === undefined || 'effectiveFrom' in rest ? {} : { effectiveFrom: validFrom }),
    ...(validTo === undefined || 'effectiveTo' in rest ? {} : { effectiveTo: validTo }),
    ...(rule === undefined || 'expression' in rest ? {} : { expression: rule }),
  };
}

const pinnedConsistent = (v: {
  versionPolicy?: string | undefined;
  pinnedVersionId?: string | null | undefined;
}) =>
  v.versionPolicy === undefined ||
  (v.versionPolicy === 'pinned') ===
    (v.pinnedVersionId !== undefined && v.pinnedVersionId !== null);

export const CreateAssignmentSchema = z
  .preprocess(
    (raw) => {
      const normalized = normalizeAliases(raw);
      if (normalized === null || typeof normalized !== 'object') return normalized;
      const v = normalized as Record<string, unknown>;
      // Prompt-3 clients sent only `pinnedVersionId`: infer the policy.
      if (v['versionPolicy'] === undefined && typeof v['pinnedVersionId'] === 'string')
        return { ...v, versionPolicy: 'pinned' };
      return v;
    },
    z.strictObject({
      scriptId: UuidSchema,
      campaignId: UuidSchema,
      priority: Fields.priority.default(100),
      versionPolicy: Fields.versionPolicy.default('latestPublished'),
      pinnedVersionId: Fields.pinnedVersionId.optional(),
      effectiveFrom: Fields.effectiveFrom.optional(),
      effectiveTo: Fields.effectiveTo.optional(),
      conditions: Fields.conditions.default({}),
      expression: Fields.expression.optional(),
      variants: Fields.variants.optional(),
    }),
  )
  .refine(window, { message: 'effectiveTo must be after effectiveFrom', path: ['effectiveTo'] })
  .refine(pinnedConsistent, {
    message: 'pinnedVersionId is required exactly when versionPolicy is pinned',
    path: ['pinnedVersionId'],
  })
  .meta({ id: 'CreateAssignment' });
export type CreateAssignmentInput = z.output<typeof CreateAssignmentSchema>;

export const UpdateAssignmentSchema = z
  .preprocess(
    normalizeAliases,
    z.strictObject({
      priority: Fields.priority.optional(),
      versionPolicy: Fields.versionPolicy.optional(),
      pinnedVersionId: Fields.pinnedVersionId.optional(),
      effectiveFrom: Fields.effectiveFrom.optional(),
      effectiveTo: Fields.effectiveTo.optional(),
      conditions: Fields.conditions.optional(),
      expression: Fields.expression.optional(),
      variants: Fields.variants.optional(),
    }),
  )
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required')
  .refine(window, { message: 'effectiveTo must be after effectiveFrom', path: ['effectiveTo'] })
  .meta({ id: 'UpdateAssignment' });
export type UpdateAssignmentInput = z.output<typeof UpdateAssignmentSchema>;

export const AssignmentListQuerySchema = listQuerySchema(
  ['priority', 'createdAt'],
  { campaignId: UuidSchema.optional(), scriptId: UuidSchema.optional() },
  'priority',
);
export type AssignmentListQuery = z.output<typeof AssignmentListQuerySchema>;
export const AssignmentPageSchema = pageSchema(AssignmentSchema).meta({ id: 'AssignmentPage' });

export function conditionsOf(raw: unknown): AssignmentConditions {
  const parsed = AssignmentConditionsSchema.safeParse(raw ?? {});
  if (!parsed.success) return {};
  return Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
}

export function variantsOf(raw: unknown): Variant[] | null {
  if (raw === null || raw === undefined) return null;
  const parsed = VariantsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const toAssignmentDto = (row: AssignmentRow): AssignmentDto => ({
  id: row.id,
  scriptId: row.scriptId,
  campaignId: row.campaignId,
  priority: row.priority,
  versionPolicy: row.versionPolicy === 'pinned' ? 'pinned' : 'latestPublished',
  pinnedVersionId: row.pinnedVersionId,
  effectiveFrom: isoOrNull(row.validFrom),
  effectiveTo: isoOrNull(row.validTo),
  conditions: conditionsOf(row.conditions) as AssignmentDto['conditions'],
  expression: row.rule ?? null,
  variants: variantsOf(row.abTest),
  validFrom: isoOrNull(row.validFrom),
  validTo: isoOrNull(row.validTo),
  rule: row.rule ?? null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
});

export const BatchAssignmentsSchema = z
  .strictObject({
    creates: z.array(CreateAssignmentSchema).max(100).default([]),
    updates: z
      .array(
        z.strictObject({
          id: UuidSchema,
          version: z.number().int().positive(),
          patch: UpdateAssignmentSchema,
        }),
      )
      .max(100)
      .default([]),
  })
  .refine((v) => v.creates.length + v.updates.length > 0, 'At least one operation required')
  .refine(
    (v) => new Set(v.updates.map((u) => u.id)).size === v.updates.length,
    'Duplicate assignment',
  )
  .meta({ id: 'BatchAssignments' });
