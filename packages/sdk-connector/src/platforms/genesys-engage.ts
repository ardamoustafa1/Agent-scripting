import { z } from 'zod';

/** Script variable names follow the event attribute grammar. */
export const EngageVariableSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
/** Genesys attached-data (KVList) keys: printable, bounded. */
export const EngageUserDataKeySchema = z.string().regex(/^[A-Za-z0-9_.:\- ]{1,128}$/);

/**
 * Attached data key → script variable for Genesys Engage connectors. Shared by the hub (mapping)
 * and the API/admin-web (`PUT /v1/connectors/:id/attached-data-map`).
 */
export const AttachedDataMappingSchema = z.strictObject({
  key: EngageUserDataKeySchema,
  variable: EngageVariableSchema,
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  /** Scripts may write the variable back to the same key. */
  writeBack: z.boolean().default(false),
  /** Classified PII: masked by the runtime/audit like other `@pii` values. */
  pii: z.boolean().default(false),
});
export type AttachedDataMapping = z.infer<typeof AttachedDataMappingSchema>;

export const AttachedDataMapSchema = z
  .array(AttachedDataMappingSchema)
  .max(300)
  .refine(
    (list) => new Set(list.map((m) => m.variable)).size === list.length,
    'variables must be unique',
  )
  .refine((list) => new Set(list.map((m) => m.key)).size === list.length, 'keys must be unique');
