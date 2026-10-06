import { Inject, Injectable } from '@nestjs/common';

import {
  requestContext,
  systemContext,
  type RequestContext,
} from '../../../common/context/request-context.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { AuditService, type AuditInput } from '../../audit/audit.service.js';

import type { Principal } from '../../../common/security/principal.js';
import type { TransactionClient } from '../../../infra/database/prisma.service.js';

/** Actor for identity flows that run before a user is known (logins, SCIM, token endpoint). */
export function identityActor(tenantId: string): Principal {
  return { type: 'service', id: 'identity', tenantId, scopes: [] };
}

export function userActor(
  tenantId: string,
  userId: string,
  sessionId?: string,
  authMethod?: Principal['authMethod'],
): Principal {
  return {
    type: 'user',
    id: userId,
    tenantId,
    scopes: [],
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(authMethod === undefined ? {} : { authMethod }),
  };
}

/**
 * Tenant transactions for public identity routes, which have no request transaction: the
 * callback runs with `actor` as the context principal, so audit and outbox writes in it commit
 * atomically with the state change (CLAUDE.md §6).
 */
@Injectable()
export class IdentityTx {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  run<T>(
    tenantId: string,
    actor: Principal,
    fn: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    const base = requestContext.get() ?? systemContext(crypto.randomUUID(), 'identity');
    const ctx: RequestContext = {
      requestId: base.requestId,
      correlationId: base.correlationId,
      ip: base.ip,
      userAgent: base.userAgent,
      principal: actor,
    };
    return requestContext.run(ctx, () =>
      this.db.run(tenantId, async (tx) => {
        ctx.tx = tx;
        try {
          return await fn(tx);
        } finally {
          delete ctx.tx;
        }
      }),
    );
  }

  /** Runs `fn` with another principal in the current context (same transaction). */
  async runAs<T>(actor: Principal, fn: () => Promise<T>): Promise<T> {
    const ctx = requestContext.require();
    const previous = ctx.principal;
    ctx.principal = actor;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete ctx.principal;
      else ctx.principal = previous;
    }
  }

  /**
   * Records one audit event in its own committed transaction. Used for failures and security
   * signals, which must persist even though the triggering request fails.
   */
  async record(tenantId: string, actor: Principal, input: AuditInput): Promise<void> {
    await this.run(tenantId, actor, async (tx) => {
      await this.audit.record(tx, input);
    });
  }
}
