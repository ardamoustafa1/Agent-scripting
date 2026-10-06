import { z } from 'zod';

import {
  CustomRoleSchema,
  CustomRoleUpdateSchema,
  MePermissionsSchema,
  type MePermissions,
} from '@verbis/authz';

export const MeSchema = z
  .object({
    principal: z.object({ type: z.enum(['user', 'service']), id: z.string(), tenantId: z.uuid() }),
    permissions: z.array(z.string()),
  })
  .meta({ id: 'Me' });
export type MeDto = z.infer<typeof MeSchema>;

export { MePermissionsSchema };
export type MePermissionsDto = MePermissions;

export const CreateRoleSchema = CustomRoleSchema.meta({ id: 'CreateCustomRole' });
export const UpdateRoleSchema = CustomRoleUpdateSchema.meta({ id: 'UpdateCustomRole' });

export const RoleSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    matrix: z.record(z.string(), z.array(z.string())),
    rules: z.array(z.unknown()),
    version: z.number().int(),
  })
  .meta({ id: 'CustomRole' });
export type RoleDto = z.infer<typeof RoleSchema>;

export const RoleScopeAssignmentSchema = z
  .strictObject({
    role: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
    scope: z.strictObject({
      campaignIds: z.union([z.literal('*'), z.array(z.uuid()).max(1000)]).optional(),
      teamIds: z.union([z.literal('*'), z.array(z.string().min(1).max(64)).max(1000)]).optional(),
      siteIds: z.union([z.literal('*'), z.array(z.string().min(1).max(64)).max(1000)]).optional(),
    }),
  })
  .meta({ id: 'RoleScopeAssignment' });
export type RoleScopeAssignment = z.infer<typeof RoleScopeAssignmentSchema>;

export const PermissionVocabularySchema = z
  .object({
    resources: z.array(z.string()),
    actions: z.record(z.string(), z.array(z.string())),
    scopes: z.record(z.string(), z.array(z.string())),
    systemRoles: z.array(
      z.object({
        key: z.string(),
        labelKey: z.string(),
        matrix: z.record(z.string(), z.array(z.string())),
      }),
    ),
  })
  .meta({ id: 'PermissionVocabulary' });
