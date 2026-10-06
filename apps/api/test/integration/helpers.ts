import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { inject } from 'vitest';

import { SYSTEM_ROLE_KEYS } from '@verbis/authz';

import { createApp } from '../../src/bootstrap.js';
import { createLogger } from '../../src/common/logging/logger.js';
import { type ApiEnv, loadApiEnv } from '../../src/env.js';
import { type Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

import type { TokenKit } from '../support/tokens.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Prompt-3 role names with permission strings. Rows that are not `@verbis/authz` system role keys
 * resolve through the legacy permission map, so these keep the existing suites meaningful.
 */
const LEGACY_ROLES: Readonly<Record<string, readonly string[]>> = {
  tenant_admin: [],
  designer: [
    'read:Campaign',
    'manage:Script',
    'manage:ScriptVersion',
    'read:Screen',
    'read:DataSource',
    'read:Assignment',
  ],
  reviewer: ['read:Script', 'read:ScriptVersion', 'read:Screen', 'publish:ScriptVersion'],
  supervisor: ['read:Campaign', 'read:Script', 'read:Session', 'read:Analytics', 'read:Assignment'],
  agent: [],
  auditor: ['read:AuditEvent', 'read:Analytics'],
  integration_admin: ['manage:DataSource', 'manage:Secret', 'manage:Connector', 'manage:Channel'],
};
const TEST_ROLES: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(SYSTEM_ROLE_KEYS.map((key) => [key, []])),
  ...LEGACY_ROLES,
};

/** Owner client: bypasses RLS (superuser) — fixtures and assertions only, never app code. */
export function ownerPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('pgOwnerUrl') }) });
}

/** Raw connection as the runtime role, for RLS tests. */
export async function appConnection(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: inject('pgAppUrl') });
  await client.connect();
  return client;
}

export function integrationEnv(jwks: string, overrides: Record<string, string> = {}): ApiEnv {
  return loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_APP_URL: inject('pgAppUrl'),
    REDIS_URL: inject('redisUrl'),
    NATS_URL: inject('natsUrl'),
    INTERNAL_JWT_JWKS: jwks,
    IDENTITY_ENCRYPTION_KEYS: `it:${Buffer.alloc(32, 9).toString('base64')}`,
    AUTH_APP_ORIGINS: 'admin=http://localhost:5175,agent=http://localhost:5174',
    PUBLIC_API_URL: 'http://localhost:4000',
    OUTBOX_RELAY_ENABLED: 'false',
    EVENT_CONSUMERS_ENABLED: 'false',
    RATE_LIMIT_MAX: '10000',
    ...overrides,
  });
}

export async function startApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const app = await createApp(env, {
    logger: createLogger(process.env['VERBIS_TEST_LOG_LEVEL'] === 'error' ? 'error' : 'fatal'),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface TenantFixture {
  readonly tenantId: string;
  readonly adminId: string;
  readonly designerId: string;
  readonly inactiveId: string;
  readonly token: (userId?: string) => Promise<string>;
  readonly auth: (userId?: string) => Promise<Record<string, string>>;
}

/** Creates an active tenant with system roles, an admin, a designer and an inactive user. */
export async function createTenant(
  owner: PrismaClient,
  kit: TokenKit,
  slug: string,
  settings: Record<string, unknown> = {},
): Promise<TenantFixture> {
  const tenant = await owner.tenant.create({
    data: {
      slug,
      name: slug,
      region: 'tr-1',
      status: 'active',
      settings: settings as Prisma.InputJsonObject,
    },
  });
  const by = 'test';
  const roles: Record<string, string> = {};
  for (const [name, permissions] of Object.entries(TEST_ROLES)) {
    const role = await owner.role.create({
      data: {
        tenantId: tenant.id,
        name,
        permissions: [...permissions],
        isSystem: true,
        createdBy: by,
        updatedBy: by,
      },
    });
    roles[name] = role.id;
  }
  const user = async (name: string, role: string, status: 'active' | 'suspended') => {
    const created = await owner.user.create({
      data: {
        tenantId: tenant.id,
        email: `${name}@${slug}.test`,
        displayName: name,
        status,
        createdBy: by,
        updatedBy: by,
      },
    });
    await owner.userRole.create({
      data: {
        tenantId: tenant.id,
        userId: created.id,
        roleId: roles[role] ?? '',
        createdBy: by,
        updatedBy: by,
      },
    });
    return created.id;
  };
  const adminId = await user('admin', 'tenant_admin', 'active');
  const designerId = await user('designer', 'designer', 'active');
  const inactiveId = await user('inactive', 'tenant_admin', 'suspended');
  const token = (userId = adminId) => kit.sign({ sub: userId, tnt: tenant.id });
  return {
    tenantId: tenant.id,
    adminId,
    designerId,
    inactiveId,
    token,
    auth: async (userId) => ({ authorization: `Bearer ${await token(userId)}` }),
  };
}

let counter = 0;
export function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(Date.now() % 1_000_000)}-${String(counter)}`;
}
