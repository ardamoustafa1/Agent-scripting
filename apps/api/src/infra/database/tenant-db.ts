import { Inject, Injectable } from '@nestjs/common';

import { requestContext } from '../../common/context/request-context.js';

import { PrismaService, type TransactionClient } from './prisma.service.js';

export interface TenantTransactionOptions {
  readonly timeoutMs?: number;
}

/**
 * Tenant-scoped transactions: every statement runs after `SET LOCAL app.tenant_id`, so Row-Level
 * Security confines it to one tenant even if application code forgets a filter.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async run<T>(
    tenantId: string,
    fn: (tx: TransactionClient) => Promise<T>,
    options: TenantTransactionOptions = {},
  ): Promise<T> {
    return this.prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      { timeout: options.timeoutMs ?? 15_000, maxWait: 5_000 },
    );
  }

  /** The transaction opened for the current request (TenantTransactionInterceptor). */
  current(): TransactionClient {
    const tx = requestContext.get()?.tx;
    if (tx === undefined) throw new Error('No tenant transaction in the current context');
    return tx;
  }

  /** Tenant of the current request principal. */
  tenantId(): string {
    const principal = requestContext.get()?.principal;
    if (principal === undefined) throw new Error('No principal in the current context');
    return principal.tenantId;
  }
}
