import { z } from 'zod';

import { ResourceMetaShape, iso } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

import type { IdpRow, RoleRow, UserRow } from './identity.repository.js';

export const UserStatusSchema = z.enum(['invited', 'active', 'suspended', 'deprovisioned']);

export const UserSchema = z
  .object({
    ...ResourceMetaShape,
    externalId: z.string().nullable(),
    email: z.string().meta({ description: '@pii' }),
    displayName: z.string().meta({ description: '@pii' }),
    status: UserStatusSchema,
    locale: z.string(),
    roles: z.array(z.string()),
  })
  .meta({ id: 'User' });
export type UserDto = z.infer<typeof UserSchema>;

export const RoleSchema = z
  .object({
    ...ResourceMetaShape,
    name: z.string(),
    description: z.string().nullable(),
    permissions: z.array(z.string()),
    isSystem: z.boolean(),
  })
  .meta({ id: 'Role' });
export type RoleDto = z.infer<typeof RoleSchema>;

/** Protocol config is not exposed: it may reference secrets. */
export const IdentityProviderSchema = z
  .object({
    ...ResourceMetaShape,
    protocol: z.enum(['oidc', 'saml']),
    displayName: z.string(),
    domainHints: z.array(z.string()),
    jitProvisioning: z.boolean(),
    scimEnabled: z.boolean(),
    status: z.enum(['draft', 'active', 'disabled']),
  })
  .meta({ id: 'IdentityProvider' });
export type IdentityProviderDto = z.infer<typeof IdentityProviderSchema>;

export const UserListQuerySchema = listQuerySchema(['createdAt', 'updatedAt'], {
  status: UserStatusSchema.optional(),
});
export type UserListQuery = z.output<typeof UserListQuerySchema>;
export const RoleListQuerySchema = listQuerySchema(['createdAt', 'name'], {});
export type RoleListQuery = z.output<typeof RoleListQuerySchema>;
export const IdpListQuerySchema = listQuerySchema(['createdAt'], {
  status: z.enum(['draft', 'active', 'disabled']).optional(),
});
export type IdpListQuery = z.output<typeof IdpListQuerySchema>;

export const UserPageSchema = pageSchema(UserSchema).meta({ id: 'UserPage' });
export const RolePageSchema = pageSchema(RoleSchema).meta({ id: 'RolePage' });
export const IdentityProviderPageSchema = pageSchema(IdentityProviderSchema).meta({
  id: 'IdentityProviderPage',
});

const meta = (row: { id: string; createdAt: Date; updatedAt: Date; version: number }) => ({
  id: row.id,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
});

export const toUserDto = (row: UserRow): UserDto => ({
  ...meta(row),
  externalId: row.externalId,
  email: row.email,
  displayName: row.displayName,
  status: row.status,
  locale: row.locale,
  roles: row.roles.map((link) => link.role.name).sort(),
});
export const toRoleDto = (row: RoleRow): RoleDto => ({
  ...meta(row),
  name: row.name,
  description: row.description,
  permissions: row.permissions,
  isSystem: row.isSystem,
});
export const toIdpDto = (row: IdpRow): IdentityProviderDto => ({
  ...meta(row),
  protocol: row.protocol,
  displayName: row.displayName,
  domainHints: row.domainHints,
  jitProvisioning: row.jitProvisioning,
  scimEnabled: row.scimEnabled,
  status: row.status,
});
