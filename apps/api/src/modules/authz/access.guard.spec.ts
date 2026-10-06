import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { DomainError, ForbiddenError } from '../../common/errors/domain-errors.js';
import { Public } from '../../common/security/public.decorator.js';

import { AbilityFactory } from './ability.factory.js';
import { AccessGuard } from './access.guard.js';
import { AnyAuthenticated, Can, RequirePermissions } from './permissions.js';

import type { AuthzRepository, RoleGrantRow } from './authz.repository.js';
import type { Principal } from '../../common/security/principal.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { TenancyRepository } from '../tenancy/tenancy.repository.js';
import type { ExecutionContext } from '@nestjs/common';

const TENANT = '0199a000-0000-7000-8000-000000000001';

class Routes {
  @Can('publish', 'Script')
  publish(): void {
    // route stub
  }

  @RequirePermissions('read:ScriptVersion')
  legacyRead(): void {
    // route stub
  }

  @Can('update', 'User')
  @Can('update', 'Role')
  both(): void {
    // route stub
  }

  @AnyAuthenticated()
  me(): void {
    // route stub
  }

  undeclared(): void {
    // route stub
  }

  @Public()
  open(): void {
    // route stub
  }
}

function guard(rows: RoleGrantRow[] | undefined, status = 'active'): AccessGuard {
  const tenantDb = {
    run: (_t: string, fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as TenantDb;
  const tenancy = {
    find: () => Promise.resolve({ id: TENANT, status, settings: {} }),
  } as unknown as TenancyRepository;
  const repository = { grantsForUser: () => Promise.resolve(rows) } as unknown as AuthzRepository;
  const audit = {
    record: () => Promise.resolve({ id: 'a', seq: 1n, hash: 'h' }),
  } as unknown as AuditService;
  return new AccessGuard(new Reflector(), tenantDb, tenancy, new AbilityFactory(repository), audit);
}

function contextFor(handler: keyof Routes, principal?: Principal): ExecutionContext {
  return {
    getHandler: () => (Routes.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({
        principal,
        method: 'GET',
        id: 'r',
        ip: '',
        routeOptions: { url: '/x' },
      }),
    }),
  } as unknown as ExecutionContext;
}

const user: Principal = { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [] };
const role = (name: string, scope: object = {}): RoleGrantRow => ({
  name,
  isSystem: true,
  permissions: [],
  rules: [],
  scope,
});

async function run(
  g: AccessGuard,
  handler: keyof Routes,
  ...principals: [Principal | undefined] | []
) {
  const principal = principals.length ? principals[0] : user;
  const ctx: RequestContext = { requestId: 'r', correlationId: 'c', ip: '', userAgent: '' };
  const result = await requestContext.run(ctx, () => g.canActivate(contextFor(handler, principal)));
  return { result, ctx };
}

describe('AccessGuard (CASL)', () => {
  it('allows @Can when the role grants it and stores the ability', async () => {
    const { result, ctx } = await run(
      guard([role('script_approver', { campaignIds: ['c'] })]),
      'publish',
    );
    expect(result).toBe(true);
    expect(ctx.authz?.ability.can('publish', 'Script')).toBe(true);
    expect(ctx.permissions?.has('publish:Script?')).toBe(true);
  });

  it('denies @Can when no role grants it', async () => {
    await expect(run(guard([role('script_designer')]), 'publish')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('translates legacy @RequirePermissions', async () => {
    const { result } = await run(guard([role('script_designer')]), 'legacyRead');
    expect(result).toBe(true);
    await expect(run(guard([role('report_viewer')]), 'legacyRead')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('requires every stacked requirement', async () => {
    await expect(run(guard([role('campaign_manager')]), 'both')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await run(guard([role('tenant_admin')]), 'both')).result).toBe(true);
  });

  it('denies routes without a declaration, allows @AnyAuthenticated and @Public', async () => {
    await expect(run(guard([role('tenant_admin')]), 'undeclared')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await run(guard([]), 'me')).result).toBe(true);
    expect((await run(guard(undefined), 'open', undefined)).result).toBe(true);
  });

  it('denies a missing principal, inactive user and inactive tenant', async () => {
    await expect(run(guard([]), 'me', undefined)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(guard(undefined), 'me')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(guard([], 'suspended'), 'me')).rejects.toBeInstanceOf(DomainError);
  });

  it('security auditor reads audit only', async () => {
    const g = guard([role('security_auditor')]);
    class AuditRoutes {
      @Can('read', 'Audit')
      read(): void {
        // route stub
      }
    }
    const ctx = {
      getHandler: () => (AuditRoutes.prototype as unknown as Record<string, unknown>)['read'],
      getClass: () => AuditRoutes,
      switchToHttp: () => ({
        getRequest: () => ({
          principal: user,
          method: 'GET',
          id: 'r',
          ip: '',
          routeOptions: { url: '/x' },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(
      await requestContext.run({ requestId: 'r', correlationId: 'c', ip: '', userAgent: '' }, () =>
        g.canActivate(ctx),
      ),
    ).toBe(true);
    await expect(run(g, 'legacyRead')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
