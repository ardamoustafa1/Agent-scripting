import { describe, expect, it } from 'vitest';

import {
  Can,
  isAllowed,
  parseRequirement,
  REQUIRED_PERMISSIONS,
  RequirePermissions,
} from './permissions.js';

describe('parseRequirement', () => {
  it.each([
    ['publish:Script', { action: 'publish', subject: 'Script' }],
    ['approve:Script', { action: 'approve', subject: 'Script' }],
    ['reveal:Session', { action: 'reveal', subject: 'Session' }],
    ['read:Idp', { action: 'read', subject: 'Idp' }],
    ['read:ScriptVersion', { action: 'read', subject: 'Script' }],
    ['manage:Group', { action: 'manage', subject: 'User' }],
    ['read:AuditEvent', { action: 'read', subject: 'Audit' }],
  ])('%s', (requirement, expected) => {
    expect(parseRequirement(requirement)).toEqual(expected);
  });

  it.each(['fly:Script', 'read:Nope', 'read:Script:x', 'approve:ScriptVersion'])(
    'rejects %s (deny by default)',
    (requirement) => {
      expect(parseRequirement(requirement)).toBeUndefined();
    },
  );
});

describe('decorators', () => {
  class Routes {
    @Can('publish', 'Script')
    publish(): void {
      // route stub
    }

    @Can('update', 'User')
    @Can('update', 'Role')
    stacked(): void {
      // route stub
    }

    @RequirePermissions('read:User', 'read:Role')
    legacy(): void {
      // route stub
    }
  }

  const meta = (name: keyof Routes) =>
    Reflect.getMetadata(
      REQUIRED_PERMISSIONS,
      (Routes.prototype as unknown as Record<string, object>)[name] ?? {},
    ) as string[];

  it('records CASL requirements', () => {
    expect(meta('publish')).toEqual(['publish:Script']);
  });

  it('accumulates stacked @Can requirements', () => {
    expect(meta('stacked').sort()).toEqual(['update:Role', 'update:User']);
  });

  it('keeps legacy requirements', () => {
    expect(meta('legacy')).toEqual(['read:User', 'read:Role']);
  });
});

describe('isAllowed (service scopes)', () => {
  it('honours manage and read wildcards', () => {
    expect(isAllowed(new Set(['manage:Script']), 'update:Script')).toBe(true);
    expect(isAllowed(new Set(['manage:all']), 'delete:User')).toBe(true);
    expect(isAllowed(new Set(['read:all']), 'read:User')).toBe(true);
    expect(isAllowed(new Set(['read:all']), 'update:User')).toBe(false);
    expect(isAllowed(new Set(['read:Script']), 'read:Script')).toBe(true);
    expect(isAllowed(new Set<string>(), 'read:Script')).toBe(false);
  });
});
