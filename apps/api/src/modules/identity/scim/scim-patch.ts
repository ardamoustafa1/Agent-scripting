import { z } from 'zod';

import { parseScimFilter, ScimFilterError, type FilterNode } from './scim-filter.js';
import { ScimError } from './scim.errors.js';
import {
  ENTERPRISE_USER_SCHEMA,
  PATCH_SCHEMA,
  ScimBoolean,
  type GroupState,
  type UserState,
} from './scim.resources.js';

export const PatchRequestSchema = z.looseObject({
  schemas: z
    .array(z.string())
    .refine((schemas) => schemas.includes(PATCH_SCHEMA), 'PatchOp schema required'),
  Operations: z
    .array(
      z.looseObject({
        op: z
          .string()
          .transform((value) => value.toLowerCase())
          .pipe(z.enum(['add', 'replace', 'remove'])),
        path: z.string().max(512).optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(1000),
});
export type PatchRequest = z.output<typeof PatchRequestSchema>;
type Operation = PatchRequest['Operations'][number];

const USER_CORE = /^urn:ietf:params:scim:schemas:core:2\.0:User:/i;
const GROUP_CORE = /^urn:ietf:params:scim:schemas:core:2\.0:Group:/i;

const str = (value: unknown, path: string, max = 512): string => {
  if (typeof value !== 'string' || value.length > max)
    throw new ScimError(400, `${path} must be a string`, 'invalidValue');
  return value;
};
const bool = (value: unknown, path: string): boolean => {
  const parsed = ScimBoolean.safeParse(value);
  if (!parsed.success) throw new ScimError(400, `${path} must be a boolean`, 'invalidValue');
  return parsed.data;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setUserAttribute(
  state: UserState,
  rawPath: string,
  value: unknown,
  op: 'add' | 'replace' | 'remove',
): void {
  if (rawPath.toLowerCase().startsWith(ENTERPRISE_USER_SCHEMA.toLowerCase())) return; // not stored
  const path = rawPath.replace(USER_CORE, '').toLowerCase();
  if (op === 'remove') {
    if (path === 'externalid') state.externalId = null;
    else if (path === 'locale') state.locale = null;
    else if (
      [
        'name',
        'name.givenname',
        'name.familyname',
        'name.formatted',
        'title',
        'phonenumbers',
        'addresses',
      ].includes(path)
    )
      return;
    else throw new ScimError(400, `cannot remove ${rawPath}`, 'mutability');
    return;
  }
  switch (path) {
    case 'active':
      state.active = bool(value, rawPath);
      return;
    case 'username':
      state.userName = str(value, rawPath, 320);
      if (EMAIL.test(state.userName)) state.email = state.userName.toLowerCase();
      return;
    case 'displayname':
    case 'name.formatted':
      state.displayName = str(value, rawPath, 256);
      return;
    case 'externalid':
      state.externalId = str(value, rawPath);
      return;
    case 'locale':
      state.locale = str(value, rawPath, 16);
      return;
    case 'name':
      if (value !== null && typeof value === 'object') {
        const name = value as Record<string, unknown>;
        if (typeof name['formatted'] === 'string')
          state.displayName = str(name['formatted'], 'name.formatted', 256);
      }
      return;
    case 'name.givenname':
    case 'name.familyname':
    case 'title':
    case 'phonenumbers':
    case 'addresses':
    case 'preferredlanguage':
    case 'nickname':
    case 'usertype':
      return; // accepted, not stored (data minimization)
    case 'emails':
    case 'emails[type eq "work"].value':
    case 'emails[primary eq true].value': {
      if (
        Array.isArray(value) &&
        value.some(
          (item: unknown) => item === null || typeof item !== 'object' || Array.isArray(item),
        )
      )
        throw new ScimError(400, `${rawPath} entries must be objects`, 'invalidValue');
      const candidate = Array.isArray(value)
        ? ((value as { value?: unknown; primary?: unknown }[]).find(
            (item) => item.primary === true || item.primary === 'True',
          )?.value ?? (value as { value?: unknown }[])[0]?.value)
        : value;
      const email = str(candidate, rawPath, 320).toLowerCase();
      if (!EMAIL.test(email))
        throw new ScimError(400, `${rawPath} must be an email`, 'invalidValue');
      state.email = email;
      return;
    }
    default:
      throw new ScimError(400, `unsupported path: ${rawPath}`, 'invalidPath');
  }
}

/** Applies RFC 7644 §3.5.2 operations to a user. */
export function applyUserPatch(current: UserState, operations: readonly Operation[]): UserState {
  const state = { ...current };
  for (const operation of operations) {
    if (operation.path === undefined) {
      if (operation.op === 'remove') throw new ScimError(400, 'remove requires a path', 'noTarget');
      if (
        operation.value === null ||
        typeof operation.value !== 'object' ||
        Array.isArray(operation.value)
      ) {
        throw new ScimError(400, 'value must be an object when path is omitted', 'invalidValue');
      }
      for (const [key, value] of Object.entries(operation.value as Record<string, unknown>)) {
        if (key === 'schemas') continue;
        if (key.toLowerCase() === ENTERPRISE_USER_SCHEMA.toLowerCase()) continue;
        setUserAttribute(state, key, value, operation.op);
      }
      continue;
    }
    setUserAttribute(state, operation.path, operation.value, operation.op);
  }
  return state;
}

function memberIds(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (item === null || typeof item !== 'object')
      throw new ScimError(400, 'members must be objects', 'invalidValue');
    return str((item as Record<string, unknown>)['value'], 'members.value', 64);
  });
}

/** `members[value eq "<id>"]` → the ids it selects (only `value eq` / `or` are meaningful). */
function membersFilterIds(filter: FilterNode): string[] {
  if (
    filter.kind === 'compare' &&
    filter.attr.toLowerCase() === 'value' &&
    filter.op === 'eq' &&
    typeof filter.value === 'string'
  ) {
    return [filter.value];
  }
  if (filter.kind === 'or')
    return [...membersFilterIds(filter.left), ...membersFilterIds(filter.right)];
  throw new ScimError(400, 'unsupported members filter', 'invalidFilter');
}

/** Applies RFC 7644 §3.5.2 operations to a group (members by user id). */
export function applyGroupPatch(current: GroupState, operations: readonly Operation[]): GroupState {
  const state: GroupState = { ...current, members: new Set(current.members) };
  for (const operation of operations) {
    const path = operation.path?.replace(GROUP_CORE, '');
    if (path === undefined) {
      if (operation.op === 'remove') throw new ScimError(400, 'remove requires a path', 'noTarget');
      const value = operation.value;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ScimError(400, 'value must be an object when path is omitted', 'invalidValue');
      }
      const record = value as Record<string, unknown>;
      if (record['displayName'] !== undefined)
        state.displayName = str(record['displayName'], 'displayName', 256);
      if (record['externalId'] !== undefined)
        state.externalId = str(record['externalId'], 'externalId');
      if (record['members'] !== undefined) {
        const ids = memberIds(record['members']);
        if (operation.op === 'replace') state.members = new Set(ids);
        else ids.forEach((id) => state.members.add(id));
      }
      continue;
    }
    const lower = path.toLowerCase();
    if (lower === 'displayname') {
      if (operation.op === 'remove')
        throw new ScimError(400, 'displayName is required', 'mutability');
      state.displayName = str(operation.value, 'displayName', 256);
    } else if (lower === 'externalid') {
      state.externalId = operation.op === 'remove' ? null : str(operation.value, 'externalId');
    } else if (lower === 'members') {
      if (operation.op === 'remove') {
        if (operation.value === undefined) state.members.clear();
        else memberIds(operation.value).forEach((id) => state.members.delete(id));
      } else {
        const ids = memberIds(operation.value);
        if (operation.op === 'replace') state.members = new Set(ids);
        else ids.forEach((id) => state.members.add(id));
      }
    } else if (lower.startsWith('members[')) {
      const match = /^members\[(.+)\]$/i.exec(path);
      if (match?.[1] === undefined || operation.op !== 'remove') {
        throw new ScimError(400, `unsupported path: ${path}`, 'invalidPath');
      }
      let filter: FilterNode;
      try {
        filter = parseScimFilter(match[1]);
      } catch (error) {
        if (error instanceof ScimFilterError)
          throw new ScimError(400, error.message, 'invalidFilter');
        throw error;
      }
      membersFilterIds(filter).forEach((id) => state.members.delete(id));
    } else {
      throw new ScimError(400, `unsupported path: ${path}`, 'invalidPath');
    }
  }
  return state;
}
