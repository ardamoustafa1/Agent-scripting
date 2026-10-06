import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { DomainError, ForbiddenError } from '../../common/errors/domain-errors.js';
import { IS_PUBLIC } from '../../common/security/public.decorator.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { ipAllowed } from '../tenancy/ip-policy.js';
import { TenancyRepository } from '../tenancy/tenancy.repository.js';

import { AbilityFactory } from './ability.factory.js';
import { typeLevelPermissions } from './authz.service.js';
import { ANY_AUTHENTICATED, parseRequirement, REQUIRED_PERMISSIONS } from './permissions.js';

import type { FastifyRequest } from 'fastify';

/**
 * Global guard after authentication:
 * 1. the principal's tenant exists and is active (read through RLS in that tenant's context);
 * 2. the CASL ability is built (user role assignments with their ABAC scope; service scopes);
 * 3. every route requirement (`@Can` / legacy `@RequirePermissions`) holds at type level.
 * Deny by default: a route without a requirement or `@AnyAuthenticated()` is refused, and so is
 * a requirement the vocabulary does not know.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(TenancyRepository) private readonly tenancy: TenancyRepository,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Authorization denials are security events: recorded in their own transaction. */
  private async denied(request: FastifyRequest, requirement: string): Promise<never> {
    const principal = request.principal;
    if (principal !== undefined) {
      const ctx = request.verbisContext as RequestContext | undefined;
      const base = ctx ?? {
        requestId: request.id,
        correlationId: request.id,
        ip: request.ip,
        userAgent: '',
      };
      await requestContext
        .run({ ...base, principal }, () =>
          this.tenantDb.run(principal.tenantId, (tx) =>
            this.audit.record(tx, {
              action: 'authz.access.denied',
              target: { type: 'Route', id: `${request.method} ${request.routeOptions.url ?? ''}` },
              outcome: 'denied',
              reason: requirement,
            }),
          ),
        )
        .catch(() => undefined);
    }
    throw new ForbiddenError();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (principal === undefined) throw new ForbiddenError();

    const resolved = await this.tenantDb.run(principal.tenantId, async (tx) => {
      const tenant = await this.tenancy.find(tx, principal.tenantId);
      if (tenant?.status !== 'active')
        throw new DomainError('VERBIS_TENANT_INACTIVE', 'The tenant is not active');
      if (!ipAllowed(tenant.settings, request.ip))
        throw new ForbiddenError('Source IP is outside the tenant allowlist');
      return this.abilities.forPrincipal(tx, principal, tenant.settings);
    });
    if (resolved === undefined) throw new ForbiddenError('The user is not active in this tenant');

    const ctx = requestContext.get();
    if (ctx !== undefined) {
      ctx.authz = resolved;
      ctx.permissions = new Set(typeLevelPermissions(resolved.rules));
    }

    const required = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, targets);
    if (
      required.length === 0 &&
      !this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets)
    ) {
      return this.denied(request, 'undeclared-route');
    }
    for (const requirement of required) {
      const parsed = parseRequirement(requirement);
      if (parsed === undefined || !resolved.ability.can(parsed.action, parsed.subject))
        return this.denied(request, requirement);
    }
    return true;
  }
}
