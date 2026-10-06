import { Injectable } from '@nestjs/common';

import {
  AccessDeniedError,
  assertCan,
  redactPii,
  serializeRules,
  SOD_REASON,
  type Action,
  type AppAbility,
  type AppRawRule,
  type AppSubject,
  type SubjectRecord,
  type SubjectType,
} from '@verbis/authz';

import { requestContext } from '../../common/context/request-context.js';
import { DomainError, ForbiddenError } from '../../common/errors/domain-errors.js';

import type { MeDto, MePermissionsDto } from './authz.dto.js';

/** Non-inverted, field-less rules as `action:Subject` strings (diagnostics, `/v1/authz/me`). */
export function typeLevelPermissions(rules: readonly AppRawRule[]): string[] {
  const out = new Set<string>();
  for (const rule of rules) {
    if (rule.inverted === true || rule.fields !== undefined) continue;
    const actions: string[] = Array.isArray(rule.action) ? rule.action : [rule.action];
    const subjects: string[] = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
    for (const action of actions)
      for (const subject of subjects) {
        out.add(`${action}:${subject}${rule.conditions === undefined ? '' : '?'}`);
      }
  }
  return [...out].sort();
}

@Injectable()
export class AuthzService {
  /** Effective permissions resolved by the AccessGuard for this request. */
  me(): MeDto {
    const ctx = requestContext.require();
    if (ctx.principal === undefined) throw new Error('No principal');
    return {
      principal: {
        type: ctx.principal.type,
        id: ctx.principal.id,
        tenantId: ctx.principal.tenantId,
      },
      permissions: [...(ctx.permissions ?? [])].sort(),
    };
  }

  /** CASL rules (packed) for UI gating in the web apps (`@verbis/authz/react`). */
  mePermissions(): MePermissionsDto {
    const ctx = requestContext.require();
    if (ctx.principal === undefined || ctx.authz === undefined) throw new Error('No principal');
    return {
      principal: {
        type: ctx.principal.type,
        id: ctx.principal.id,
        tenantId: ctx.principal.tenantId,
      },
      roles: [...ctx.authz.roles],
      rules: serializeRules(ctx.authz.rules),
      separationOfDuties: ctx.authz.separationOfDuties,
    };
  }

  ability(): AppAbility {
    const ability = requestContext.require().authz?.ability;
    if (ability === undefined) throw new ForbiddenError();
    return ability;
  }

  /**
   * Instance-level (ABAC) check inside a use case, e.g.
   * `authorize('approve', asSubject('Script', { campaignIds, authorIds }))`.
   */
  authorize(action: Action, target: AppSubject, field?: string): void {
    try {
      assertCan(this.ability(), action, target, field);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        if (error.reason === SOD_REASON)
          throw new DomainError(
            'VERBIS_AUTHZ_SOD_VIOLATION',
            'The author of a version cannot approve or publish it',
          );
        if (
          typeof target !== 'string' &&
          target.__caslSubjectType__ === 'Script' &&
          Array.isArray(target['campaignIds']) &&
          target['campaignIds'].length === 0 &&
          this.ability().can(action, 'Script')
        )
          throw new DomainError(
            'VERBIS_AUTHZ_SCOPE_MISSING',
            'This script has no campaign assignment. Choose a campaign within your scope when creating it, or ask an administrator to assign it.',
            [{ path: '/campaignId', message: 'a campaign within your scope is required' }],
          );
        throw new ForbiddenError();
      }
      throw error;
    }
  }

  can(action: Action, target: AppSubject, field?: string): boolean {
    return this.ability().can(action, target, field);
  }

  /** Masks `@pii` fields the caller may not reveal (field-level authorization). */
  redact<T extends SubjectRecord>(type: Exclude<SubjectType, 'all'>, record: T): T {
    return redactPii(this.ability(), type, record);
  }
}
