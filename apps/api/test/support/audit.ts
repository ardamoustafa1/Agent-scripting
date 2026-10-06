import { generateKeyPairSync } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import { requestContext, type RequestContext } from '../../src/common/context/request-context.js';
import { PrismaService } from '../../src/infra/database/prisma.service.js';
import { TenantDb } from '../../src/infra/database/tenant-db.js';
import { OutboxWriter } from '../../src/infra/outbox/outbox.writer.js';
import { AuditRepository } from '../../src/modules/audit/audit.repository.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';

import type { ApiEnv } from '../../src/env.js';

/** Fresh Ed25519 checkpoint key pair (private JWK + public JWKS). */
export function checkpointKeys(kid = 'it-audit') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    signingJwk: JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid }),
    jwks: JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid }] }),
  };
}

/** Audit services wired by hand against a given role (deterministic: no background jobs). */
export function auditStack(env: ApiEnv) {
  const prisma = new PrismaService(env);
  const tenantDb = new TenantDb(prisma);
  const audit = new AuditService(new OutboxWriter());
  const repository = new AuditRepository();
  return { prisma, tenantDb, audit, repository };
}

export function workerTestEnv(base: ApiEnv): ApiEnv {
  return {
    ...base,
    DATABASE_APP_URL: inject('pgWorkerUrl'),
    AUDIT_WORKER_DATABASE_URL: inject('pgWorkerUrl'),
  };
}

export function systemCtx(tenantId: string): RequestContext {
  return { requestId: 'it', correlationId: `it-${tenantId}`, ip: '', userAgent: 'it' };
}

export async function asSystem<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return requestContext.run(systemCtx(tenantId), fn);
}

export async function roleClient(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** SQLSTATE of a failed statement ('ok' when it succeeded). */
export async function sqlState(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}
