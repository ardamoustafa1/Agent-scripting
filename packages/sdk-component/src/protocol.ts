import { z } from 'zod';

import {
  JsonValueSchema,
  ComponentTypeSchema,
  PropNameSchema,
  EventKeySchema,
} from '@verbis/script-schema';

export const PluginManifestSchema = z.strictObject({
  type: ComponentTypeSchema.refine((type) => type.includes('.')),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  integrity: z.string().regex(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/),
  builtOn: z.array(z.enum(['box', 'button', 'webService'])).min(1),
  permissions: z
    .strictObject({
      props: z.array(PropNameSchema).max(64).default([]),
      write: z.array(PropNameSchema).max(32).default([]),
      events: z.array(EventKeySchema).max(32).default([]),
    })
    .prefault({}),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export const TenantApprovalSchema = z.strictObject({
  tenantId: z.uuid(),
  enabled: z.boolean(),
  type: ComponentTypeSchema,
  version: z.string(),
  integrity: z.string(),
  bundleUrl: z.url(),
  approvedOrigins: z.array(z.url()).max(20),
  expiresAt: z.number().int().positive(),
});
export type TenantApproval = z.infer<typeof TenantApprovalSchema>;
export const GuestMessageSchema = z.discriminatedUnion('op', [
  z.strictObject({
    protocol: z.literal(1),
    seq: z.number().int().positive(),
    op: z.literal('emit'),
    event: EventKeySchema,
  }),
  z.strictObject({
    protocol: z.literal(1),
    seq: z.number().int().positive(),
    op: z.literal('write'),
    prop: PropNameSchema,
    value: JsonValueSchema,
  }),
  z.strictObject({
    protocol: z.literal(1),
    seq: z.number().int().positive(),
    op: z.literal('resize'),
    height: z.number().int().min(24).max(1200),
  }),
]);
export type GuestMessage = z.infer<typeof GuestMessageSchema>;
export const HostStateSchema = z.strictObject({
  protocol: z.literal(1),
  op: z.literal('state'),
  props: z.record(PropNameSchema, JsonValueSchema),
  locale: z.enum(['tr', 'en']),
  enabled: z.boolean(),
});
export const HostReplySchema = z.strictObject({
  protocol: z.literal(1),
  op: z.literal('reply'),
  seq: z.number().int().positive(),
  ok: z.boolean(),
});
