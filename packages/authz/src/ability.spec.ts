import { describe, expect, it } from 'vitest';

import {
  abilityFromSerialized,
  asSubject,
  assertCan,
  AccessDeniedError,
  buildRules,
  createAbility,
  defineAbilityFor,
  MASK,
  redactPii,
  serializeRules,
} from './ability.js';
import { SYSTEM_ROLES } from './roles.js';
import { resolveRule, RuleDefinitionSchema } from './rules.js';

describe('rule resolution', () => {
  it('substitutes user and scope placeholders', () => {
    expect(
      resolveRule(
        {
          action: 'read',
          subject: 'Session',
          conditions: { agentId: '${user.id}', teamId: { $in: '${scope.teamIds}' } },
        },
        { userId: 'u', scope: { teamIds: ['t'] } },
      ),
    ).toEqual({
      action: 'read',
      subject: 'Session',
      conditions: { agentId: 'u', teamId: { $in: ['t'] } },
    });
  });

  it('drops a condition when the scope is unrestricted', () => {
    expect(
      resolveRule(
        {
          action: 'read',
          subject: 'Script',
          conditions: { campaignIds: { $in: '${scope.campaignIds}' } },
        },
        { userId: 'u', scope: { campaignIds: '*' } },
      ),
    ).toEqual({ action: 'read', subject: 'Script' });
  });

  it('missing scope resolves to an empty set', () => {
    expect(
      resolveRule(
        {
          action: 'read',
          subject: 'Script',
          conditions: { campaignIds: { $in: '${scope.siteIds}' } },
        },
        { userId: 'u', scope: {} },
      ),
    ).toEqual({ action: 'read', subject: 'Script', conditions: { campaignIds: { $in: [] } } });
  });

  it('drops an inverted rule whose condition resolves to "any"', () => {
    expect(
      resolveRule(
        {
          action: 'read',
          subject: 'Script',
          inverted: true,
          conditions: { x: ['${scope.teamIds}'] },
        },
        { userId: 'u', scope: { teamIds: '*' } },
      ),
    ).toBeUndefined();
  });

  it('keeps literals and nested arrays', () => {
    expect(
      resolveRule(
        {
          action: 'read',
          subject: 'Report',
          conditions: { a: 1, b: true, c: null, d: ['x', '${user.id}'] },
        },
        { userId: 'u', scope: {} },
      ),
    ).toEqual({
      action: 'read',
      subject: 'Report',
      conditions: { a: 1, b: true, c: null, d: ['x', 'u'] },
    });
  });

  it('rejects unknown operators and fields at the edge', () => {
    expect(
      RuleDefinitionSchema.safeParse({
        action: 'read',
        subject: 'Script',
        conditions: { a: { $where: 'x' } },
      }).success,
    ).toBe(false);
    expect(
      RuleDefinitionSchema.safeParse({
        action: 'read',
        subject: 'Script',
        conditions: { a: [{ $regex: 'x' }] },
      }).success,
    ).toBe(false);
    expect(RuleDefinitionSchema.safeParse({ action: 'fly', subject: 'Script' }).success).toBe(
      false,
    );
    expect(RuleDefinitionSchema.safeParse({ action: 'read', subject: 'Nope' }).success).toBe(false);
    expect(
      RuleDefinitionSchema.safeParse({ action: 'read', subject: 'Script', extra: 1 }).success,
    ).toBe(false);
    expect(
      RuleDefinitionSchema.safeParse({
        action: 'read',
        subject: 'Script',
        conditions: { a: { $in: ['x'] } },
      }).success,
    ).toBe(true);
  });
});

describe('serialization for /me/permissions', () => {
  it('round-trips through packRules with identical decisions', () => {
    const rules = buildRules({
      userId: 'u',
      grants: [{ rules: SYSTEM_ROLES.agent.rules, scope: { campaignIds: ['c'] } }],
    });
    const packed = serializeRules(rules);
    const json = JSON.parse(JSON.stringify(packed)) as typeof packed;
    const client = abilityFromSerialized(json);
    const server = createAbility(rules);
    for (const [action, target] of [
      ['update', asSubject('Session', { agentId: 'u' })],
      ['update', asSubject('Session', { agentId: 'x' })],
      ['read', asSubject('Script', { campaignIds: ['c'] })],
      ['read', asSubject('Script', { campaignIds: ['d'] })],
      ['publish', 'Script'],
    ] as const) {
      expect(client.can(action, target)).toBe(server.can(action, target));
    }
  });
});

describe('field-level PII', () => {
  const user = { id: 'u-2', email: 'someone@example.test', displayName: 'Someone', teamIds: ['t'] };

  it('masks PII for roles without reveal', () => {
    const ability = defineAbilityFor({
      userId: 'u',
      grants: [{ rules: SYSTEM_ROLES.campaign_manager.rules, scope: {} }],
    });
    expect(redactPii(ability, 'User', user)).toEqual({ ...user, email: MASK, displayName: MASK });
  });

  it('reveals for tenant admins', () => {
    const ability = defineAbilityFor({
      userId: 'u',
      grants: [{ rules: SYSTEM_ROLES.tenant_admin.rules, scope: {} }],
    });
    expect(redactPii(ability, 'User', user)).toEqual(user);
  });

  it('reveals only permitted fields and leaves absent fields absent', () => {
    const ability = defineAbilityFor({
      userId: 'u',
      grants: [{ rules: SYSTEM_ROLES.agent.rules, scope: {} }],
    });
    expect(redactPii(ability, 'Session', { agentId: 'u', customer: { n: 1 } })).toEqual({
      agentId: 'u',
      customer: { n: 1 },
    });
    expect(
      redactPii(ability, 'Session', { agentId: 'x', customer: { n: 1 }, variables: {} }),
    ).toEqual({
      agentId: 'x',
      customer: MASK,
      variables: MASK,
    });
  });

  it('copies subjects without PII fields unchanged', () => {
    const ability = createAbility([]);
    const record = { id: 'c' };
    const out = redactPii(ability, 'Campaign', record);
    expect(out).toEqual(record);
    expect(out).not.toBe(record);
  });

  it('asSubject does not mutate the input', () => {
    const record = { id: 'c' };
    asSubject('Campaign', record);
    expect(Object.keys(record)).toEqual(['id']);
  });
});

describe('assertCan', () => {
  it('passes when allowed and throws AccessDeniedError otherwise', () => {
    const ability = createAbility([{ action: 'read', subject: 'Script' }]);
    expect(() => {
      assertCan(ability, 'read', 'Script');
    }).not.toThrow();
    expect(() => {
      assertCan(ability, 'update', 'Script');
    }).toThrow(AccessDeniedError);
  });
});
