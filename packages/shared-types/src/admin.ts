import { z } from 'zod';

const Day = z.number().int().min(30).max(36500);
export const AdminBrandSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoUrl: z
    .union([z.literal(''), z.url().refine((value) => /^https:\/\/[^/@?#]+(?:[/?#]|$)/.test(value))])
    .default(''),
  agentTitle: z.string().max(100).default(''),
  waitingText: z.string().max(200).default(''),
});
export const AdminSecuritySchema = z.strictObject({
  ipAllowlist: z
    .array(
      z
        .string()
        .max(64)
        .refine((value) => {
          const [ip, prefix, ...extra] = value.split('/');
          return (
            extra.length === 0 &&
            z.union([z.ipv4(), z.ipv6()]).safeParse(ip).success &&
            (prefix === undefined ||
              (/^\d{1,3}$/.test(prefix) && Number(prefix) <= ((ip ?? '').includes(':') ? 128 : 32)))
          );
        }),
    )
    .max(100)
    .default([]),
});
export const AdminRetentionSchema = z.strictObject({
  retentionDays: Day,
  sessionRetentionDays: Day,
  analyticsRetentionDays: Day,
  legalHold: z.boolean(),
});
export const AdminQuotaSchema = z.strictObject({
  maxUsers: z.number().int().min(1).max(100000),
  maxActiveSessions: z.number().int().min(1).max(100000),
  maxScripts: z.number().int().min(1).max(100000),
});
export const AdminTenantInputSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().trim().min(1).max(100),
  region: z.string().min(1).max(64),
  status: z.enum(['provisioning', 'active', 'suspended']),
  quotas: AdminQuotaSchema,
  features: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/), z.boolean()),
});
export const AdminTenantViewSchema = AdminTenantInputSchema.extend({
  id: z.uuid(),
  status: z.enum(['provisioning', 'active', 'suspended', 'deleting']),
  version: z.number().int(),
});
export const AdminPrivacyInputSchema = z.strictObject({
  kind: z.enum(['search', 'export', 'anonymize']),
  subject: z.string().trim().min(1).max(256),
  verified: z.literal(true),
  reason: z.string().trim().min(10).max(1000),
});
export const AdminPrivacyViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['search', 'export', 'anonymize']),
  state: z.enum(['pending', 'completed', 'blocked']),
  createdAt: z.string(),
  count: z.number().int(),
  version: z.number().int(),
});
export const AdminPublicJwksSchema = z
  .strictObject({
    keys: z
      .array(
        z
          .strictObject({
            kty: z.enum(['EC', 'OKP']),
            kid: z.string().min(1).max(128),
            crv: z.enum(['P-256', 'Ed25519']),
            x: z.string().regex(/^[A-Za-z0-9_-]+$/),
            y: z
              .string()
              .regex(/^[A-Za-z0-9_-]+$/)
              .optional(),
            alg: z.enum(['ES256', 'EdDSA']).optional(),
            use: z.literal('sig').optional(),
          })
          .refine((key) =>
            key.kty === 'EC'
              ? key.crv === 'P-256' && Boolean(key.y) && key.alg !== 'EdDSA'
              : key.crv === 'Ed25519' && !key.y && key.alg !== 'ES256',
          ),
      )
      .min(1)
      .max(10),
  })
  .refine((value) => new Set(value.keys.map((key) => key.kid)).size === value.keys.length);

export const AdminClassificationSchema = z
  .array(
    z.strictObject({
      path: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,255}$/),
      classification: z.enum(['public', 'internal', 'pii', 'pci']),
      purpose: z.string().trim().min(1).max(256),
    }),
  )
  .max(200)
  .refine((entries) => new Set(entries.map((entry) => entry.path)).size === entries.length);
