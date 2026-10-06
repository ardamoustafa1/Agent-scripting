import { describe, expect, it } from 'vitest';

import { asSubject, defineAbilityFor } from './ability.js';
import { SYSTEM_ROLE_KEYS, SYSTEM_ROLES, isSystemRoleKey, type SystemRoleKey } from './roles.js';
import { RESOURCE_ACTIONS, RESOURCE_SUBJECT, RESOURCES, type Action } from './vocabulary.js';

const ME = 'u-me';
const scopeAll = { campaignIds: '*', teamIds: '*', siteIds: '*' } as const;

function abilityOf(key: SystemRoleKey, scope: object = scopeAll) {
  return defineAbilityFor({
    userId: ME,
    grants: [{ rules: SYSTEM_ROLES[key].rules, scope }],
    settings: { separationOfDuties: false },
  });
}

/**
 * Expected matrix (type level, unrestricted scope): role → resource → granted actions.
 * Anything not listed must be denied. This table IS the contract; change it deliberately.
 */
const EXPECTED: Record<SystemRoleKey, Partial<Record<(typeof RESOURCES)[number], Action[]>>> = {
  super_admin: Object.fromEntries(RESOURCES.map((r) => [r, [...RESOURCE_ACTIONS[r]]])),
  tenant_admin: Object.fromEntries(RESOURCES.map((r) => [r, [...RESOURCE_ACTIONS[r]]])),
  security_auditor: { audit: ['read', 'export'] },
  script_designer: {
    campaign: ['read'],
    script: ['read', 'create', 'update', 'delete'],
    screen: ['read', 'create', 'update', 'delete'],
    integration: ['read'],
  },
  script_approver: {
    campaign: ['read'],
    script: ['read', 'approve', 'publish'],
    screen: ['read'],
  },
  integration_engineer: {
    integration: [...RESOURCE_ACTIONS.integration],
    secret: [...RESOURCE_ACTIONS.secret],
    connector: [...RESOURCE_ACTIONS.connector],
    campaign: ['read'],
  },
  campaign_manager: {
    campaign: ['read', 'create', 'update', 'delete'],
    script: ['read'],
    report: ['read'],
    user: ['read'],
  },
  supervisor: {
    campaign: ['read'],
    script: ['read'],
    session: ['read', 'reveal'],
    user: ['read'],
    report: ['read'],
  },
  agent: {
    script: ['read'],
    screen: ['read'],
    session: ['read', 'create', 'update', 'reveal'],
    user: ['read'],
  },
  report_viewer: { report: ['read', 'export'] },
  api_client: {
    campaign: ['read'],
    script: ['read'],
    screen: ['read'],
    report: ['read'],
    session: ['read', 'create', 'update'],
  },
};

const MATRIX_CASES = SYSTEM_ROLE_KEYS.flatMap((role) =>
  RESOURCES.flatMap((resource) =>
    RESOURCE_ACTIONS[resource]
      .filter((action) => action !== 'manage')
      .map((action) => ({
        role,
        resource,
        action,
        expected: EXPECTED[role][resource]?.includes(action) ?? false,
      })),
  ),
);

describe('system role permission matrix', () => {
  it('covers every system role', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it.each(MATRIX_CASES)(
    '$role → $action $resource = $expected',
    ({ role, resource, action, expected }) => {
      expect(abilityOf(role).can(action, RESOURCE_SUBJECT[resource])).toBe(expected);
    },
  );

  it.each(SYSTEM_ROLE_KEYS.filter((k) => k !== 'super_admin' && k !== 'tenant_admin'))(
    '%s cannot touch platform subjects',
    (role) => {
      const ability = abilityOf(role);
      for (const subject of ['Tenant', 'BreakGlassAccount', 'Outbox', 'ApiDocs'] as const) {
        expect(ability.can('read', subject)).toBe(false);
        expect(ability.can('manage', subject)).toBe(false);
      }
    },
  );

  it('only super_admin is a platform role', () => {
    expect(SYSTEM_ROLE_KEYS.filter((k) => SYSTEM_ROLES[k].platform)).toEqual(['super_admin']);
  });

  it('every role has an i18n label key', () => {
    for (const key of SYSTEM_ROLE_KEYS)
      expect(SYSTEM_ROLES[key].labelKey).toBe(`authz.roles.${key}`);
  });

  it('recognises system role keys', () => {
    expect(isSystemRoleKey('agent')).toBe(true);
    expect(isSystemRoleKey('designer')).toBe(false);
  });
});

describe('ABAC scope of system roles', () => {
  const scoped = { campaignIds: ['c-1'], teamIds: ['t-1'], siteIds: [] };

  it('designer edits only scripts of assigned campaigns', () => {
    const ability = abilityOf('script_designer', scoped);
    expect(ability.can('update', asSubject('Script', { campaignIds: ['c-1', 'c-9'] }))).toBe(true);
    expect(ability.can('update', asSubject('Script', { campaignIds: ['c-2'] }))).toBe(false);
    expect(ability.can('update', asSubject('Script', { campaignIds: [] }))).toBe(false);
    expect(ability.can('read', asSubject('Campaign', { id: 'c-1' }))).toBe(true);
    expect(ability.can('read', asSubject('Campaign', { id: 'c-2' }))).toBe(false);
  });

  it('a scoped role without any assigned campaign grants nothing on instances', () => {
    const ability = abilityOf('script_designer', {});
    expect(ability.can('read', asSubject('Script', { campaignIds: ['c-1'] }))).toBe(false);
  });

  it('approver approves only within assigned campaigns', () => {
    const ability = abilityOf('script_approver', scoped);
    expect(ability.can('approve', asSubject('Script', { campaignIds: ['c-1'] }))).toBe(true);
    expect(ability.can('approve', asSubject('Script', { campaignIds: ['c-3'] }))).toBe(false);
  });

  it('supervisor sees sessions and reveals PII of own teams only', () => {
    const ability = abilityOf('supervisor', scoped);
    const mine = asSubject('Session', { teamId: 't-1', agentId: 'a' });
    const other = asSubject('Session', { teamId: 't-2', agentId: 'a' });
    expect(ability.can('read', mine)).toBe(true);
    expect(ability.can('read', other)).toBe(false);
    expect(ability.can('reveal', mine, 'customer')).toBe(true);
    expect(ability.can('reveal', mine, 'variables')).toBe(false);
    expect(ability.can('reveal', other, 'customer')).toBe(false);
  });

  it('agent works on own sessions only', () => {
    const ability = abilityOf('agent', scoped);
    expect(ability.can('update', asSubject('Session', { agentId: ME }))).toBe(true);
    expect(ability.can('update', asSubject('Session', { agentId: 'someone' }))).toBe(false);
    expect(ability.can('read', asSubject('User', { id: ME }))).toBe(true);
    expect(ability.can('read', asSubject('User', { id: 'someone' }))).toBe(false);
  });

  it('report viewer is campaign scoped', () => {
    const ability = abilityOf('report_viewer', scoped);
    expect(ability.can('export', asSubject('Report', { campaignId: 'c-1' }))).toBe(true);
    expect(ability.can('export', asSubject('Report', { campaignId: 'c-2' }))).toBe(false);
  });

  it('campaign manager may create campaigns but edits only assigned ones', () => {
    const ability = abilityOf('campaign_manager', scoped);
    expect(ability.can('create', 'Campaign')).toBe(true);
    expect(ability.can('update', asSubject('Campaign', { id: 'c-1' }))).toBe(true);
    expect(ability.can('update', asSubject('Campaign', { id: 'c-2' }))).toBe(false);
  });

  it('grants never combine across assignments', () => {
    const ability = defineAbilityFor({
      userId: ME,
      grants: [
        { rules: SYSTEM_ROLES.script_designer.rules, scope: { campaignIds: ['c-a'] } },
        { rules: SYSTEM_ROLES.script_approver.rules, scope: { campaignIds: ['c-b'] } },
      ],
      settings: { separationOfDuties: false },
    });
    expect(ability.can('approve', asSubject('Script', { campaignIds: ['c-a'] }))).toBe(false);
    expect(ability.can('approve', asSubject('Script', { campaignIds: ['c-b'] }))).toBe(true);
    expect(ability.can('update', asSubject('Script', { campaignIds: ['c-b'] }))).toBe(false);
  });
});
