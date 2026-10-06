import { describe, expect, it } from 'vitest';

import { asSubject, defineAbilityFor } from './ability.js';
import { legacyPermissionsToRules, parseLegacyPermission } from './legacy.js';
import {
  CustomRoleSchema,
  CustomRoleUpdateSchema,
  findEscalations,
  matrixToRules,
  rulesToMatrix,
} from './matrix.js';
import { SYSTEM_ROLES } from './roles.js';
import { RESOURCE_ACTIONS } from './vocabulary.js';

describe('custom role permission matrix', () => {
  it('turns a scoped matrix into rules that enforce the scope', () => {
    const role = CustomRoleSchema.parse({
      name: 'regional-qa',
      matrix: {
        script: { actions: ['read', 'update'], scope: 'campaign' },
        session: { actions: ['read'], scope: 'own', revealPii: true },
        user: { actions: ['read'], scope: 'team' },
        audit: { actions: ['read'] },
      },
    });
    const rules = matrixToRules(role.matrix);
    const ability = defineAbilityFor({
      userId: 'u',
      grants: [{ rules, scope: { campaignIds: ['c'], teamIds: ['t'] } }],
    });
    expect(ability.can('update', asSubject('Script', { campaignIds: ['c'] }))).toBe(true);
    expect(ability.can('update', asSubject('Script', { campaignIds: ['d'] }))).toBe(false);
    expect(ability.can('read', asSubject('Session', { agentId: 'u' }))).toBe(true);
    expect(ability.can('read', asSubject('Session', { agentId: 'v' }))).toBe(false);
    expect(ability.can('reveal', asSubject('Session', { agentId: 'u' }), 'customer')).toBe(true);
    expect(ability.can('read', asSubject('User', { teamIds: ['t'] }))).toBe(true);
    expect(ability.can('read', 'Audit')).toBe(true);
    expect(ability.can('export', 'Audit')).toBe(false);
  });

  it('defaults scope to all and revealPii to false', () => {
    const role = CustomRoleSchema.parse({
      name: 'viewer',
      matrix: { user: { actions: ['read'] } },
    });
    expect(matrixToRules(role.matrix)).toEqual([{ action: ['read'], subject: 'User' }]);
  });

  it.each([
    [{ audit: { actions: ['delete'] } }, 'matrix.audit.actions'],
    [{ secret: { actions: ['read'], scope: 'campaign' } }, 'matrix.secret.scope'],
    [{ script: { actions: ['read'], revealPii: true } }, 'matrix.script.revealPii'],
  ])('rejects invalid cell %j', (matrix, path) => {
    const result = CustomRoleSchema.safeParse({ name: 'bad', matrix });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(path);
  });

  it('update schema validates the matrix and forbids renaming', () => {
    expect(
      CustomRoleUpdateSchema.safeParse({ matrix: { user: { actions: ['read'] } } }).success,
    ).toBe(true);
    expect(
      CustomRoleUpdateSchema.safeParse({ matrix: { audit: { actions: ['delete'] } } }).success,
    ).toBe(false);
    expect(CustomRoleUpdateSchema.safeParse({ name: 'x', matrix: {} }).success).toBe(false);
  });

  it('rejects unknown resources and bad names', () => {
    expect(
      CustomRoleSchema.safeParse({ name: 'x1', matrix: { tenant: { actions: ['read'] } } }).success,
    ).toBe(false);
    expect(CustomRoleSchema.safeParse({ name: 'Bad Name', matrix: {} }).success).toBe(false);
  });

  it('projects rules back to a matrix (manage expands, inverted/field rules ignored)', () => {
    expect(rulesToMatrix(SYSTEM_ROLES.integration_engineer.rules)).toEqual({
      integration: [...RESOURCE_ACTIONS.integration].sort(),
      secret: [...RESOURCE_ACTIONS.secret].sort(),
      connector: [...RESOURCE_ACTIONS.connector].sort(),
      campaign: ['read'],
    });
    expect(rulesToMatrix(SYSTEM_ROLES.tenant_admin.rules).audit).toEqual(['export', 'read']);
    expect(
      rulesToMatrix([
        { action: 'read', subject: 'Script', inverted: true },
        { action: 'reveal', subject: 'User', fields: ['email'] },
        { action: 'read', subject: 'Tenant' },
      ]),
    ).toEqual({});
  });

  it('finds privilege escalations against the granter', () => {
    const granter = defineAbilityFor({
      userId: 'u',
      grants: [{ rules: SYSTEM_ROLES.campaign_manager.rules, scope: {} }],
    });
    expect(
      findEscalations(granter, [
        { action: 'read', subject: 'Campaign' },
        { action: ['read', 'delete'], subject: ['User'] },
        { action: 'reveal', subject: 'User', fields: ['email'] },
        { action: 'read', subject: 'Secret', inverted: true },
      ]),
    ).toEqual([
      { action: 'delete', subject: 'User' },
      { action: 'reveal', subject: 'User' },
    ]);
  });
});

describe('legacy permission strings', () => {
  it.each([
    ['read:ScriptVersion', { action: 'read', subject: 'Script' }],
    ['manage:Group', { action: 'manage', subject: 'User' }],
    ['read:AuditEvent', { action: 'read', subject: 'Audit' }],
    ['update:IdentityProvider', { action: 'update', subject: 'Idp' }],
    ['manage:all', { action: 'manage', subject: 'all' }],
    ['manage:Outbox', { action: 'manage', subject: 'Outbox' }],
  ])('%s', (permission, expected) => {
    expect(parseLegacyPermission(permission)).toEqual(expected);
  });

  it.each(['fly:Script', 'read:Nope', 'read', 'read:Script:x', ''])('ignores %j', (permission) => {
    expect(parseLegacyPermission(permission)).toBeUndefined();
  });

  it('converts lists', () => {
    expect(legacyPermissionsToRules(['read:Campaign', 'bad'])).toEqual([
      { action: 'read', subject: 'Campaign' },
    ]);
  });
});
