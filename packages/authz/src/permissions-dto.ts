import { z } from 'zod';

/**
 * `GET /v1/me/permissions` payload: CASL rules packed with `packRules`, resolved for the caller
 * (placeholders substituted, SoD applied). Build the UI ability with `abilityFromSerialized`.
 */
export const MePermissionsSchema = z
  .object({
    principal: z.object({ type: z.enum(['user', 'service']), id: z.string(), tenantId: z.uuid() }),
    roles: z.array(z.string()),
    rules: z.array(z.array(z.unknown())),
    separationOfDuties: z.boolean(),
  })
  .meta({ id: 'MePermissions' });
export type MePermissions = z.infer<typeof MePermissionsSchema>;
