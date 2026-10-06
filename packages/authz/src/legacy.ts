import type { RuleDefinition } from './rules.js';
import type { Action, SubjectType } from './vocabulary.js';

/**
 * The prompt-3 permission strings (`action:Subject`) are still used by `@RequirePermissions`,
 * stored role permissions and service-client scopes. They translate 1:1 into unconditional rules.
 */
export const LEGACY_SUBJECTS: Readonly<Record<string, SubjectType>> = {
  Tenant: 'Tenant',
  User: 'User',
  Group: 'User',
  Role: 'Role',
  IdentityProvider: 'Idp',
  ServiceClient: 'Integration',
  BreakGlassAccount: 'BreakGlassAccount',
  Campaign: 'Campaign',
  Assignment: 'Campaign',
  Script: 'Script',
  ScriptVersion: 'Script',
  Screen: 'Screen',
  DataSource: 'Integration',
  Secret: 'Secret',
  Connector: 'Connector',
  Channel: 'Connector',
  Session: 'Session',
  AuditEvent: 'Audit',
  Analytics: 'Report',
  Outbox: 'Outbox',
  ApiDocs: 'ApiDocs',
  all: 'all',
};

const LEGACY_ACTIONS: ReadonlySet<string> = new Set([
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'manage',
]);

export interface ActionSubject {
  readonly action: Action;
  readonly subject: SubjectType;
}

/** `update:ScriptVersion` → `{ action: 'update', subject: 'Script' }`; unknown → undefined. */
export function parseLegacyPermission(permission: string): ActionSubject | undefined {
  const [action, legacySubject, extra] = permission.split(':');
  if (extra !== undefined || action === undefined || legacySubject === undefined) return undefined;
  if (!LEGACY_ACTIONS.has(action)) return undefined;
  const subject = LEGACY_SUBJECTS[legacySubject];
  if (subject === undefined) return undefined;
  return { action: action as Action, subject };
}

export function legacyPermissionsToRules(permissions: readonly string[]): RuleDefinition[] {
  const rules: RuleDefinition[] = [];
  for (const permission of permissions) {
    const parsed = parseLegacyPermission(permission);
    if (parsed === undefined) continue;
    // `read:all` historically meant read-only access to everything.
    rules.push({ action: parsed.action, subject: parsed.subject });
  }
  return rules;
}
