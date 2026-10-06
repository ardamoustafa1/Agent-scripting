import { describe, expect, it } from 'vitest';

import { asSubject } from '@verbis/authz';

import { AbilityFactory, grantFromRow, parseTenantAuthzSettings } from './ability.factory.js';

import type { AuthzRepository, RoleGrantRow } from './authz.repository.js';
import type { Principal } from '../../common/security/principal.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const tx = {} as TransactionClient;
const TENANT = '0199a000-0000-7000-8000-000000000001';
const user: Principal = { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [] };

function factory(rows: RoleGrantRow[] | undefined): AbilityFactory {
  const repository = { grantsForUser: () => Promise.resolve(rows) } as unknown as AuthzRepository;
  return new AbilityFactory(repository);
}

const row = (overrides: Partial<RoleGrantRow>): RoleGrantRow => ({
  name: 'script_designer',
  isSystem: true,
  permissions: [],
  rules: [],
  scope: {},
  ...overrides,
});

describe('parseTenantAuthzSettings', () => {
  it('defaults SoD on and platform off', () => {
    expect(parseTenantAuthzSettings({})).toMatchObject({
      platform: false,
      authz: { separationOfDuties: true },
    });
    expect(parseTenantAuthzSettings(undefined).authz.separationOfDuties).toBe(true);
  });

  it('reads the tenant setting and keeps other keys', () => {
    const parsed = parseTenantAuthzSettings({
      authz: { separationOfDuties: false },
      defaultLocale: 'tr',
    });
    expect(parsed.authz.separationOfDuties).toBe(false);
  });

  it('fails safe (SoD on) on malformed settings', () => {
    expect(
      parseTenantAuthzSettings({ authz: { separationOfDuties: 'no' } }).authz.separationOfDuties,
    ).toBe(true);
  });
});

describe('grantFromRow', () => {
  const settings = parseTenantAuthzSettings({});

  it('system roles take rules from code', () => {
    const grant = grantFromRow(row({ rules: [{ action: 'manage', subject: 'all' }] }), settings);
    expect(grant?.rules.some((rule) => rule.subject === 'all')).toBe(false);
  });

  it('super_admin only counts in the platform tenant', () => {
    expect(grantFromRow(row({ name: 'super_admin' }), settings)).toBeUndefined();
    expect(
      grantFromRow(row({ name: 'super_admin' }), { ...settings, platform: true }),
    ).toBeDefined();
  });

  it('custom roles use stored rules plus legacy permissions', () => {
    const grant = grantFromRow(
      row({
        name: 'qa',
        isSystem: false,
        rules: [{ action: 'read', subject: 'Report' }],
        permissions: ['read:AuditEvent'],
      }),
      settings,
    );
    expect(grant?.rules).toEqual([
      { action: 'read', subject: 'Report' },
      { action: 'read', subject: 'Audit' },
    ]);
  });

  it('invalid stored rules and scope grant nothing extra (fail closed)', () => {
    const grant = grantFromRow(
      row({
        name: 'qa',
        isSystem: false,
        rules: [{ action: 'read', subject: 'Report', conditions: { a: { $where: '1' } } }],
        scope: 'bad',
      }),
      settings,
    );
    expect(grant).toEqual({ rules: [], scope: {} });
  });
});

describe('AbilityFactory', () => {
  it('builds a scoped user ability with SoD', async () => {
    const resolved = await factory([
      row({ name: 'script_designer', scope: { campaignIds: ['c-1'] } }),
      row({ name: 'script_approver', scope: { campaignIds: ['c-1'] } }),
    ]).forPrincipal(tx, user, {});
    expect(resolved?.roles).toEqual(['script_approver', 'script_designer']);
    expect(resolved?.separationOfDuties).toBe(true);
    const ability = resolved!.ability;
    expect(ability.can('update', asSubject('Script', { campaignIds: ['c-1'] }))).toBe(true);
    expect(ability.can('update', asSubject('Script', { campaignIds: ['c-2'] }))).toBe(false);
    expect(
      ability.can('approve', asSubject('Script', { campaignIds: ['c-1'], authorIds: ['u-1'] })),
    ).toBe(false);
    expect(
      ability.can('approve', asSubject('Script', { campaignIds: ['c-1'], authorIds: ['u-2'] })),
    ).toBe(true);
  });

  it('respects SoD switched off by the tenant', async () => {
    const resolved = await factory([
      row({ name: 'script_approver', scope: { campaignIds: '*' } }),
    ]).forPrincipal(tx, user, { authz: { separationOfDuties: false } });
    expect(
      resolved?.ability.can(
        'approve',
        asSubject('Script', { campaignIds: ['x'], authorIds: ['u-1'] }),
      ),
    ).toBe(true);
  });

  it('returns undefined for inactive users', async () => {
    expect(await factory(undefined).forPrincipal(tx, user, {})).toBeUndefined();
  });

  it('service principals get their scopes as rules', async () => {
    const service: Principal = {
      type: 'service',
      id: 'crm',
      tenantId: TENANT,
      scopes: ['read:Campaign'],
    };
    const resolved = await factory([]).forPrincipal(tx, service, {});
    expect(resolved?.ability.can('read', 'Campaign')).toBe(true);
    expect(resolved?.ability.can('update', 'Campaign')).toBe(false);
    expect(resolved?.roles).toEqual([]);
  });
});

it('BI service grants recognize canonical read/export Report scopes and ignore invalid scopes', async () => {
  const resolved = await factory([]).forPrincipal(
    tx,
    {
      type: 'service',
      id: 'bi-reader',
      tenantId: TENANT,
      scopes: ['read:Report', 'export:Report', 'bad:Report'],
    },
    {},
  );
  expect(resolved?.ability.can('read', 'Report')).toBe(true);
  expect(resolved?.ability.can('export', 'Report')).toBe(true);
  expect(resolved?.ability.can('manage', 'Report')).toBe(false);
});
