import { z } from 'zod';

import { LocaleSchema } from '@verbis/script-schema';
import {
  AdminBrandSchema,
  AdminRetentionSchema,
  AdminSecuritySchema,
  AdminClassificationSchema,
} from '@verbis/shared-types';

import { IsoDateTime, UuidSchema, iso } from '../../common/dto.js';
import { EmbeddingSettingsSchema } from '../launch/domain/frame-policy.js';

import type { TenantRow } from './tenancy.repository.js';

const Origin = z
  .string()
  .regex(
    /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/,
    'origin must be https://host[:port] (http only for localhost)',
  );

/** Session policy of the tenant (SECURITY S4); unset fields fall back to the SESSION_* env defaults. */
export const SessionSettingsSchema = z
  .strictObject({
    idleTimeoutMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
    absoluteTimeoutHours: z.number().int().min(1).max(168).optional(),
    maxConcurrentSessions: z.number().int().min(1).max(100).optional(),
    /** At the limit: end the oldest session, or refuse the new sign-in. */
    onLimit: z.enum(['evict_oldest', 'deny']).optional(),
  })
  .meta({ id: 'SessionSettings' });

export const TenantSettingsSchema = z
  .looseObject({
    defaultLocale: LocaleSchema.optional(),
    /** Browser origins allowed by CORS for this tenant (exact match, no wildcards). */
    allowedOrigins: z.array(Origin).max(50).optional(),
    sessionTimeoutMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
    session: SessionSettingsSchema.optional(),
    security: AdminSecuritySchema.optional(),
    brand: AdminBrandSchema.optional(),
    classifications: AdminClassificationSchema.optional(),
    audit: AdminRetentionSchema.optional(),
    authz: z.strictObject({ separationOfDuties: z.boolean() }).optional(),
    /** Hosts allowed to frame agent-web (Genesys, Avaya, CRM); everything else is DENY. */
    embedding: EmbeddingSettingsSchema.optional(),
  })
  .meta({ id: 'TenantSettings' });

export const TenantSchema = z
  .object({
    id: UuidSchema,
    slug: z.string(),
    name: z.string(),
    region: z.string(),
    status: z.enum(['provisioning', 'active', 'suspended', 'deleting']),
    settings: TenantSettingsSchema,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    version: z.number().int(),
  })
  .meta({ id: 'Tenant' });
export type TenantDto = z.infer<typeof TenantSchema>;

export const UpdateTenantSettingsSchema = z
  .strictObject({
    embedding: EmbeddingSettingsSchema.optional(),
    defaultLocale: LocaleSchema.optional(),
    allowedOrigins: z.array(Origin).max(50).optional(),
    sessionTimeoutMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
    session: SessionSettingsSchema.optional(),
    security: AdminSecuritySchema.optional(),
    brand: AdminBrandSchema.optional(),
    classifications: AdminClassificationSchema.optional(),
    audit: AdminRetentionSchema.optional(),
    authz: z.strictObject({ separationOfDuties: z.boolean() }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one setting is required')
  .meta({ id: 'UpdateTenantSettings' });
export type UpdateTenantSettingsInput = z.output<typeof UpdateTenantSettingsSchema>;

export function toTenantDto(row: TenantRow): TenantDto {
  const settings = TenantSettingsSchema.safeParse(row.settings);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    region: row.region,
    status: row.status,
    settings: settings.success ? settings.data : {},
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}
