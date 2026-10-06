import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { instruments } from '@verbis/observability';

import { type ApiEnv, API_ENV } from '../../env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

export function createPrismaClient(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 20,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30000,
  });
  const connections = (result: {
    observe(value: number, attributes?: Record<string, string>): void;
  }) => {
    result.observe(pool.totalCount - pool.idleCount, { state: 'used' });
    result.observe(pool.idleCount, { state: 'idle' });
    result.observe(20, { state: 'capacity' });
  };
  const waiting = (result: { observe(value: number): void }) => {
    result.observe(pool.waitingCount);
  };
  instruments.pool.addCallback(connections);
  instruments.poolWaiting.addCallback(waiting);
  pool.once('end', () => {
    instruments.pool.removeCallback(connections);
    instruments.poolWaiting.removeCallback(waiting);
  });
  return new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    // @secret: ciphertext is never selected unless a query opts in explicitly.
    omit: { secret: { ciphertext: true } },
  });
}

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;
export type TransactionClient = Parameters<Parameters<AppPrismaClient['$transaction']>[0]>[0];

/** Database readiness probe contract (lets health checks be tested without Postgres). */
export abstract class DatabaseProbe {
  abstract ping(): Promise<void>;
}

export class PrivilegedRoleError extends Error {
  override readonly name = 'PrivilegedRoleError';
}

@Injectable()
export class PrismaService extends DatabaseProbe implements OnModuleInit, OnModuleDestroy {
  readonly client: AppPrismaClient;
  readonly #logger = new Logger(PrismaService.name);

  constructor(@Inject(API_ENV) env: ApiEnv) {
    super();
    this.client = createPrismaClient(env.DATABASE_APP_URL);
  }

  /** Refuses to run with a role that could bypass Row-Level Security (ADR-0003). */
  async onModuleInit(): Promise<void> {
    try {
      await this.assertLeastPrivilege();
    } catch (error) {
      if (error instanceof PrivilegedRoleError) throw error;
      // Database unreachable at boot: readiness reports it; do not crash-loop.
      this.#logger.warn('Database not reachable at startup; readiness will report it');
    }
  }

  async assertLeastPrivilege(): Promise<void> {
    const rows = await this.client.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean; owner: boolean }[]
    >`
      SELECT r.rolsuper, r.rolbypassrls,
             EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owner
        FROM pg_roles r WHERE r.rolname = current_user`;
    const role = rows[0];
    if (role === undefined || role.rolsuper || role.rolbypassrls || role.owner) {
      throw new PrivilegedRoleError(
        'DATABASE_APP_URL must use the least-privilege verbis_app role (not superuser, owner or BYPASSRLS)',
      );
    }
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
