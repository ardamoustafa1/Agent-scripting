import { SetMetadata } from '@nestjs/common';

import {
  ACTIONS,
  parseLegacyPermission,
  SUBJECT_TYPES,
  type Action,
  type ActionSubject,
  type SubjectType,
} from '@verbis/authz';

import { appendRouteDoc } from '../../openapi/metadata.js';

/**
 * Prompt-3 permission vocabulary `action:Subject`. Still accepted by `@RequirePermissions` and
 * service-client scopes; the guard translates it to CASL (`@verbis/authz` legacy map). New code
 * uses `@Can(action, Subject)`.
 */
export const LEGACY_SUBJECTS = [
  'Tenant',
  'User',
  'Role',
  'IdentityProvider',
  'Group',
  'ServiceClient',
  'BreakGlassAccount',
  'Campaign',
  'Script',
  'ScriptVersion',
  'Screen',
  'Assignment',
  'DataSource',
  'Secret',
  'Connector',
  'Channel',
  'Session',
  'AuditEvent',
  'Analytics',
  'Outbox',
  'ApiDocs',
] as const;
export type Subject = (typeof LEGACY_SUBJECTS)[number] | 'all';
export type LegacyAction = 'read' | 'create' | 'update' | 'delete' | 'publish' | 'manage';
export type Permission = `${LegacyAction}:${Subject}`;

/** Scope-string subset check (service-client token scopes). */
export function isAllowed(granted: ReadonlySet<string>, required: Permission): boolean {
  const [action, subject] = required.split(':') as [LegacyAction, Subject];
  return (
    granted.has(required) ||
    granted.has(`manage:${subject}`) ||
    granted.has('manage:all') ||
    (action === 'read' && granted.has('read:all'))
  );
}

/** Parses a route requirement: CASL vocabulary first (`publish:Script`), then the legacy map. */
export function parseRequirement(requirement: string): ActionSubject | undefined {
  const [action, subject, extra] = requirement.split(':');
  if (
    extra === undefined &&
    (ACTIONS as readonly string[]).includes(action ?? '') &&
    (SUBJECT_TYPES as readonly string[]).includes(subject ?? '')
  ) {
    return { action: action as Action, subject: subject as SubjectType };
  }
  return parseLegacyPermission(requirement);
}

export const REQUIRED_PERMISSIONS = 'verbis:required-permissions';

/** Stacked decorators accumulate: every requirement must hold. */
function requireAll(requirements: string[]): MethodDecorator {
  return (target, key, descriptor) => {
    const existing =
      (Reflect.getMetadata(REQUIRED_PERMISSIONS, descriptor.value as object) as
        string[] | undefined) ?? [];
    SetMetadata(REQUIRED_PERMISSIONS, [...existing, ...requirements])(target, key, descriptor);
    appendRouteDoc(target, key, { permissions: requirements });
  };
}

/**
 * Route-level CASL check: the caller must be able to perform `action` on SOME `subject`
 * (type level). Instance conditions (campaign/team scope, SoD) are enforced in the use case with
 * `AuthzService.authorize(action, asSubject(type, record))`.
 */
export function Can(action: Action, subject: SubjectType): MethodDecorator {
  return requireAll([`${action}:${subject}`]);
}

/** Prompt-3 form; prefer `@Can(action, Subject)` in new code. All listed are required. */
export function RequirePermissions(...permissions: Permission[]): MethodDecorator {
  return requireAll(permissions);
}

export const ANY_AUTHENTICATED = 'verbis:any-authenticated';

/** Explicit opt-out of permission checks for routes every authenticated principal may call. */
export function AnyAuthenticated(): MethodDecorator {
  return (target, key, descriptor) => {
    SetMetadata(ANY_AUTHENTICATED, true)(target, key, descriptor);
  };
}
