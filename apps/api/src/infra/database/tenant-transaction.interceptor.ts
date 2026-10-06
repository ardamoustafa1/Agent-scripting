import {
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defaultIfEmpty, from, lastValueFrom, type Observable } from 'rxjs';

import { requestContext } from '../../common/context/request-context.js';
import { IS_PUBLIC } from '../../common/security/public.decorator.js';

import { TenantDb } from './tenant-db.js';

import type { FastifyRequest } from 'fastify';

export const OWN_TENANT_TRANSACTIONS = 'verbis:own-tenant-transactions';
/** Only services explicitly managing every SQL operation in short tenant transactions. */
export const OwnTenantTransactions = () => SetMetadata(OWN_TENANT_TRANSACTIONS, true);

/**
 * Unit of work per request: the handler, its audit events, outbox events and idempotency record
 * run in one transaction with `app.tenant_id` set (RLS). Public routes skip it.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = request.verbisContext;
    const principal = request.principal;
    if (principal === undefined) return next.handle();
    ctx.principal = principal;
    if (this.reflector.get<boolean>(OWN_TENANT_TRANSACTIONS, context.getHandler())) {
      return from(requestContext.run(ctx, () => lastValueFrom(next.handle())));
    }
    return from(
      requestContext.run(ctx, () =>
        this.tenantDb.run(principal.tenantId, async (tx) => {
          ctx.tx = tx;
          try {
            return await lastValueFrom(
              (next.handle() as Observable<unknown>).pipe(defaultIfEmpty(undefined)),
            );
          } finally {
            delete ctx.tx;
          }
        }),
      ),
    );
  }
}
