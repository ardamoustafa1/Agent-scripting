import { z } from 'zod';

import { LocaleSchema } from '@verbis/script-schema';

import {
  ChannelTypeSchema,
  IsoDateTime,
  ResourceMetaShape,
  iso,
  isoOrNull,
} from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';
import { WorkingHoursSchema } from '../routing/domain/working-hours.js';

import type { CampaignRow } from './campaigns.repository.js';

export const CampaignStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);

/** Platform objects that route interactions to this campaign (one owner per object). */
export const ExternalMappingSchema = z
  .strictObject({
    platform: z.enum([
      'genesys-cloud',
      'genesys-engage',
      'avaya-aes',
      'avaya-aacc',
      'avaya-axp',
      'amazon-connect',
      'cisco',
      'nice-cxone',
      'five9',
      'generic',
    ]),
    /** e.g. queue, campaign, skill, vdn, routingPoint, flow, dnis. */
    kind: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*$/)
      .max(32),
    externalId: z.string().trim().min(1).max(256),
  })
  .meta({ id: 'CampaignExternalMapping' });
export type ExternalMapping = z.infer<typeof ExternalMappingSchema>;

export const OutcomeSchema = z
  .strictObject({
    code: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9_-]*$/)
      .max(64),
    /** i18n key or literal label shown to agents. */
    label: z.string().trim().min(1).max(200),
    category: z.enum(['success', 'failure', 'callback', 'noContact', 'other']),
    requiresNote: z.boolean().default(false),
    requiredFields: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
          .max(64),
      )
      .max(50)
      .default([]),
    subCodes: z
      .array(
        z
          .string()
          .regex(/^[A-Z0-9][A-Z0-9_-]*$/)
          .max(64),
      )
      .max(50)
      .default([]),
  })
  .meta({ id: 'CampaignOutcome' });

const uniqueBy =
  <T>(key: (item: T) => string) =>
  (items: readonly T[]) =>
    new Set(items.map(key)).size === items.length;

export const CampaignSchema = z
  .object({
    ...ResourceMetaShape,
    code: z.string().nullable(),
    locales: z.array(z.string()),
    externalMappings: z.array(ExternalMappingSchema),
    workingHours: WorkingHoursSchema.nullable(),
    outcomeSet: z.array(OutcomeSchema),
    name: z.string(),
    description: z.string().nullable(),
    status: CampaignStatusSchema,
    defaultLocale: z.string(),
    channels: z.array(ChannelTypeSchema),
    queues: z.array(z.string()),
    startsAt: IsoDateTime.nullable(),
    endsAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'Campaign' });
export type CampaignDto = z.infer<typeof CampaignSchema>;

function window(value: {
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}): boolean {
  const { startsAt, endsAt } = value;
  if (startsAt === undefined || startsAt === null || endsAt === undefined || endsAt === null)
    return true;
  return new Date(endsAt) > new Date(startsAt);
}

const CampaignFields = {
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'A-Z, 0-9, _ and - only')
    .max(64),
  locales: z
    .array(LocaleSchema)
    .max(20)
    .refine((l) => new Set(l).size === l.length, 'locales must be unique'),
  externalMappings: z
    .array(ExternalMappingSchema)
    .max(200)
    .refine(
      uniqueBy((m: ExternalMapping) => `${m.platform}:${m.kind}:${m.externalId}`),
      'duplicate mapping',
    ),
  workingHours: WorkingHoursSchema.nullable(),
  outcomeSet: z
    .array(OutcomeSchema)
    .max(200)
    .refine(
      uniqueBy((o: { code: string }) => o.code),
      'outcome codes must be unique',
    ),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  defaultLocale: LocaleSchema,
  channels: z
    .array(ChannelTypeSchema)
    .max(8)
    .refine((items) => new Set(items).size === items.length, 'channels must be unique'),
  queues: z.array(z.string().trim().min(1).max(128)).max(50),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
};

export const CreateCampaignSchema = z
  .strictObject({
    name: CampaignFields.name,
    /** Derived from the name when omitted. */
    code: CampaignFields.code.optional(),
    locales: CampaignFields.locales.default([]),
    externalMappings: CampaignFields.externalMappings.default([]),
    workingHours: CampaignFields.workingHours.optional(),
    outcomeSet: CampaignFields.outcomeSet.default([]),
    description: CampaignFields.description.optional(),
    status: z.enum(['draft', 'active', 'paused']).default('draft'),
    defaultLocale: CampaignFields.defaultLocale.default('tr'),
    channels: CampaignFields.channels.default([]),
    queues: CampaignFields.queues.default([]),
    startsAt: CampaignFields.startsAt.optional(),
    endsAt: CampaignFields.endsAt.optional(),
  })
  .refine(window, { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .meta({ id: 'CreateCampaign' });
export type CreateCampaignInput = z.output<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z
  .strictObject({
    name: CampaignFields.name.optional(),
    code: CampaignFields.code.optional(),
    locales: CampaignFields.locales.optional(),
    externalMappings: CampaignFields.externalMappings.optional(),
    workingHours: CampaignFields.workingHours.optional(),
    outcomeSet: CampaignFields.outcomeSet.optional(),
    description: CampaignFields.description.optional(),
    status: CampaignStatusSchema.optional(),
    defaultLocale: CampaignFields.defaultLocale.optional(),
    channels: CampaignFields.channels.optional(),
    queues: CampaignFields.queues.optional(),
    startsAt: CampaignFields.startsAt.optional(),
    endsAt: CampaignFields.endsAt.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required')
  .refine(window, { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .meta({ id: 'UpdateCampaign' });
export type UpdateCampaignInput = z.output<typeof UpdateCampaignSchema>;

export const CampaignListQuerySchema = listQuerySchema(['createdAt', 'updatedAt', 'name'], {
  status: CampaignStatusSchema.optional(),
  channel: ChannelTypeSchema.optional(),
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({ description: 'Case-insensitive name contains' }),
});
export type CampaignListQuery = z.output<typeof CampaignListQuerySchema>;

export const CampaignPageSchema = pageSchema(CampaignSchema).meta({ id: 'CampaignPage' });

export function toCampaignDto(row: CampaignRow): CampaignDto {
  return {
    id: row.id,
    code: row.code,
    locales: row.locales,
    externalMappings: row.mappings.map((m) => ({
      platform: m.platform as ExternalMapping['platform'],
      kind: m.kind,
      externalId: m.externalId,
    })),
    workingHours: row.workingHours === null ? null : WorkingHoursSchema.parse(row.workingHours),
    outcomeSet: OutcomeSchema.array().parse(row.outcomeSet),
    name: row.name,
    description: row.description,
    status: row.status,
    defaultLocale: row.defaultLocale,
    channels: row.channels,
    queues: row.queues,
    startsAt: isoOrNull(row.startsAt),
    endsAt: isoOrNull(row.endsAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}
