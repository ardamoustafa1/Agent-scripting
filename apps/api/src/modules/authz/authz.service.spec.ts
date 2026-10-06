import { describe, expect, it } from 'vitest';

import {
  abilityFromSerialized,
  asSubject,
  buildRules,
  createAbility,
  MASK,
  SYSTEM_ROLES,
} from '@verbis/authz';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { type DomainError, ForbiddenError } from '../../common/errors/domain-errors.js';

import { AuthzService, typeLevelPermissions } from './authz.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';

function withRoles<T>(
  roles: (keyof typeof SYSTEM_ROLES)[],
  fn: (service: AuthzService) => T,
  scope = {},
): T {
  const rules = buildRules({
    userId: 'u-1',
    grants: roles.map((key) => ({ rules: SYSTEM_ROLES[key].rules, scope })),
  });
  const ctx: RequestContext = {
    requestId: 'r',
    correlationId: 'c',
    ip: '',
    userAgent: '',
    principal: { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [] },
    authz: { ability: createAbility(rules), rules, roles, separationOfDuties: true },
    permissions: new Set(typeLevelPermissions(rules)),
  };
  return requestContext.run(ctx, () => fn(new AuthzService()));
}

describe('AuthzService', () => {
  it('explains absent campaign scope without weakening denied campaigns or missing roles', () => {
    withRoles(
      ['script_designer'],
      (s) => {
        expect(() => {
          s.authorize('update', asSubject('Script', { campaignIds: [] }));
        }).toThrow(expect.objectContaining({ code: 'VERBIS_AUTHZ_SCOPE_MISSING' }));
        expect(() => {
          s.authorize('publish', asSubject('Script', { campaignIds: [] }));
        }).toThrow(ForbiddenError);
        expect(() => {
          s.authorize('update', asSubject('Script', { campaignIds: ['outside'] }));
        }).toThrow(ForbiddenError);
      },
      { campaignIds: ['c-1'] },
    );
  });
  it('serializes rules for /v1/me/permissions that rebuild the same ability', () => {
    const dto = withRoles(['script_designer'], (s) => s.mePermissions(), { campaignIds: ['c-1'] });
    expect(dto.roles).toEqual(['script_designer']);
    expect(dto.separationOfDuties).toBe(true);
    const ui = abilityFromSerialized(dto.rules as never);
    expect(ui.can('update', asSubject('Script', { campaignIds: ['c-1'] }))).toBe(true);
    expect(ui.can('update', asSubject('Script', { campaignIds: ['c-2'] }))).toBe(false);
    expect(ui.can('publish', 'Script')).toBe(false);
  });

  it('authorize maps SoD denials to VERBIS_AUTHZ_SOD_VIOLATION', () => {
    withRoles(
      ['script_approver'],
      (s) => {
        expect(() => {
          s.authorize('approve', asSubject('Script', { campaignIds: ['c'], authorIds: ['u-1'] }));
        }).toThrow(expect.objectContaining({ code: 'VERBIS_AUTHZ_SOD_VIOLATION' }) as DomainError);
        expect(() => {
          s.authorize('approve', asSubject('Script', { campaignIds: ['c'], authorIds: ['u-2'] }));
        }).not.toThrow();
      },
      { campaignIds: '*' },
    );
  });

  it('authorize maps other denials to ForbiddenError', () => {
    withRoles(
      ['script_designer'],
      (s) => {
        expect(() => {
          s.authorize('update', asSubject('Script', { campaignIds: ['other'] }));
        }).toThrow(ForbiddenError);
        expect(s.can('update', asSubject('Script', { campaignIds: ['c-1'] }))).toBe(true);
      },
      { campaignIds: ['c-1'] },
    );
  });

  it('redacts PII the caller may not reveal', () => {
    const user = { id: 'u-9', email: 'x@example.test', displayName: 'X' };
    expect(withRoles(['campaign_manager'], (s) => s.redact('User', user))).toEqual({
      id: 'u-9',
      email: MASK,
      displayName: MASK,
    });
    expect(withRoles(['tenant_admin'], (s) => s.redact('User', user))).toEqual(user);
  });

  it('me() lists type-level permissions; conditional ones are marked with ?', () => {
    const me = withRoles(['agent'], (s) => s.me());
    expect(me.permissions).toContain('create:Session');
    expect(me.permissions).toContain('update:Session?');
    expect(me.permissions.some((p) => p.startsWith('reveal'))).toBe(false);
  });

  it('throws without a resolved ability', () => {
    const ctx: RequestContext = { requestId: 'r', correlationId: 'c', ip: '', userAgent: '' };
    requestContext.run(ctx, () => {
      expect(() => new AuthzService().ability()).toThrow(ForbiddenError);
    });
  });
});

it('fails closed when the resolved principal is absent', () => {
  const ctx: RequestContext = { requestId: 'r', correlationId: 'c', ip: '', userAgent: '' };
  requestContext.run(ctx, () => {
    const service = new AuthzService();
    expect(() => service.me()).toThrow('No principal');
    expect(() => service.mePermissions()).toThrow('No principal');
    expect(() => {
      service.authorize('read', 'Script');
    }).toThrow(ForbiddenError);
  });
});
