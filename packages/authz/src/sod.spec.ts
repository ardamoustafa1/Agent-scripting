import { describe, expect, it } from 'vitest';

import { asSubject, assertCan, AccessDeniedError, defineAbilityFor } from './ability.js';
import { SYSTEM_ROLES } from './roles.js';
import { authorIdsOf, SOD_REASON } from './sod.js';

const grants = [
  { rules: SYSTEM_ROLES.script_designer.rules, scope: { campaignIds: '*' as const } },
  { rules: SYSTEM_ROLES.script_approver.rules, scope: { campaignIds: '*' as const } },
];

describe('separation of duties', () => {
  const version = (authors: string[]) =>
    asSubject('Script', { campaignIds: ['c-1'], authorIds: authors });

  it('an author cannot approve or publish their own version (default on)', () => {
    const ability = defineAbilityFor({ userId: 'u-1', grants });
    expect(ability.can('approve', version(['u-1']))).toBe(false);
    expect(ability.can('publish', version(['u-2', 'u-1']))).toBe(false);
    expect(ability.can('approve', version(['u-2']))).toBe(true);
  });

  it('applies to tenant admins too', () => {
    const ability = defineAbilityFor({
      userId: 'u-1',
      grants: [{ rules: SYSTEM_ROLES.tenant_admin.rules, scope: {} }],
      settings: { separationOfDuties: true },
    });
    expect(ability.can('approve', version(['u-1']))).toBe(false);
    expect(ability.can('update', version(['u-1']))).toBe(true);
  });

  it('can be switched off per tenant', () => {
    const ability = defineAbilityFor({
      userId: 'u-1',
      grants,
      settings: { separationOfDuties: false },
    });
    expect(ability.can('approve', version(['u-1']))).toBe(true);
  });

  it('denial carries the SoD reason', () => {
    const ability = defineAbilityFor({ userId: 'u-1', grants });
    expect(() => {
      assertCan(ability, 'approve', version(['u-1']));
    }).toThrow(AccessDeniedError);
    try {
      assertCan(ability, 'approve', version(['u-1']));
    } catch (error) {
      expect((error as AccessDeniedError).reason).toBe(SOD_REASON);
      expect((error as AccessDeniedError).action).toBe('approve');
      expect((error as AccessDeniedError).subjectType).toBe('Script');
    }
  });

  it('collects authors from created/updated/contributors and strips actor prefixes', () => {
    expect(
      authorIdsOf({
        createdBy: 'user:u-1',
        updatedBy: 'user:u-2',
        contributors: ['u-3', 'user:u-1'],
      }).sort(),
    ).toEqual(['u-1', 'u-2', 'u-3']);
    expect(authorIdsOf({ createdBy: 'service:ci' })).toEqual(['service:ci']);
  });
});
