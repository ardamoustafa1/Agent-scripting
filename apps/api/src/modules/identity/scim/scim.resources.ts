import { z } from 'zod';

import { CtiIdentitiesSchema } from '@verbis/shared-types';

import { ScimError } from './scim.errors.js';

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
/** Verbis extension: platform (CTI) identities used to map platform agents to this user. */
export const CTI_USER_SCHEMA = 'urn:verbis:params:scim:schemas:extension:cti:2.0:User';
export const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** SCIM clients (notably Entra ID) send booleans as "True"/"False" strings. */
export const ScimBoolean = z.union([
  z.boolean(),
  z
    .string()
    .regex(/^(true|false)$/i)
    .transform((value) => value.toLowerCase() === 'true'),
]);

const Email = z.looseObject({
  value: z.string().max(320),
  type: z.string().max(32).optional(),
  primary: ScimBoolean.optional(),
});

export const ScimUserInputSchema = z.looseObject({
  schemas: z.array(z.string()).optional(),
  userName: z.string().trim().min(1).max(320),
  externalId: z.string().max(512).nullable().optional(),
  name: z
    .looseObject({
      formatted: z.string().max(256).optional(),
      givenName: z.string().max(128).optional(),
      familyName: z.string().max(128).optional(),
    })
    .optional(),
  displayName: z.string().max(256).optional(),
  emails: z.array(Email).max(20).optional(),
  active: ScimBoolean.optional(),
  locale: z.string().max(16).optional(),
  [CTI_USER_SCHEMA]: z
    .looseObject({
      identities: CtiIdentitiesSchema.max(20),
    })
    .optional(),
});
export type ScimUserInput = z.output<typeof ScimUserInputSchema>;

export const ScimGroupInputSchema = z.looseObject({
  schemas: z.array(z.string()).optional(),
  displayName: z.string().trim().min(1).max(256),
  externalId: z.string().max(512).nullable().optional(),
  members: z
    .array(z.looseObject({ value: z.string().max(64) }))
    .max(10_000)
    .optional(),
});
export type ScimGroupInput = z.output<typeof ScimGroupInputSchema>;

/** The user attributes Verbis stores (DOMAIN User). */
export interface UserState {
  userName: string;
  email: string;
  externalId: string | null;
  displayName: string;
  active: boolean;
  locale: string | null;
  /** Platform identities from the CTI extension; `undefined` leaves the stored ones unchanged. */
  ctiIdentities?: { platform: string; id: string }[];
}

export interface GroupState {
  displayName: string;
  externalId: string | null;
  members: Set<string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function userStateFromInput(input: ScimUserInput): UserState {
  const emails = input.emails ?? [];
  const primary = emails.find((email) => email.primary === true) ?? emails[0];
  const email = (primary?.value ?? input.userName).trim().toLowerCase();
  if (!EMAIL.test(email))
    throw new ScimError(400, 'A valid email (userName or emails) is required', 'invalidValue');
  const formatted = [input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ');
  return {
    userName: input.userName,
    email,
    externalId: input.externalId ?? null,
    displayName:
      input.displayName ?? input.name?.formatted ?? (formatted === '' ? input.userName : formatted),
    active: input.active ?? true,
    locale: input.locale ?? null,
    ...(input[CTI_USER_SCHEMA] === undefined
      ? {}
      : { ctiIdentities: input[CTI_USER_SCHEMA].identities }),
  };
}

export interface UserRowForScim {
  id: string;
  externalId: string | null;
  email: string;
  displayName: string;
  status: 'invited' | 'active' | 'suspended' | 'deprovisioned';
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  groups: { group: { id: string; displayName: string } }[];
}

export function toScimUser(row: UserRowForScim, baseUrl: string): Record<string, unknown> {
  return {
    schemas: [USER_SCHEMA],
    id: row.id,
    ...(row.externalId === null ? {} : { externalId: row.externalId }),
    userName: row.email,
    name: { formatted: row.displayName },
    displayName: row.displayName,
    emails: [{ value: row.email, type: 'work', primary: true }],
    active: row.status === 'active',
    locale: row.locale,
    groups: row.groups.map((link) => ({
      value: link.group.id,
      display: link.group.displayName,
      $ref: `${baseUrl}/Groups/${link.group.id}`,
    })),
    meta: {
      resourceType: 'User',
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${baseUrl}/Users/${row.id}`,
      version: `W/"${String(row.version)}"`,
    },
  };
}

export interface GroupRowForScim {
  id: string;
  externalId: string | null;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  members: { user: { id: string; email: string } }[];
}

export function toScimGroup(
  row: GroupRowForScim,
  baseUrl: string,
  options: { includeMembers?: boolean } = {},
): Record<string, unknown> {
  return {
    schemas: [GROUP_SCHEMA],
    id: row.id,
    ...(row.externalId === null ? {} : { externalId: row.externalId }),
    displayName: row.displayName,
    ...(options.includeMembers === false
      ? {}
      : {
          members: row.members.map((link) => ({
            value: link.user.id,
            display: link.user.email,
            $ref: `${baseUrl}/Users/${link.user.id}`,
          })),
        }),
    meta: {
      resourceType: 'Group',
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${baseUrl}/Groups/${row.id}`,
      version: `W/"${String(row.version)}"`,
    },
  };
}
