import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  type TenantFixture,
  uniqueSlug,
} from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let kit: TokenKit;
let owner: PrismaClient;
let app: NestFastifyApplication;
let a: TenantFixture;
let b: TenantFixture;
const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  a = await createTenant(owner, kit, uniqueSlug('loc-a'));
  b = await createTenant(owner, kit, uniqueSlug('loc-b'));
  app = await startApp(integrationEnv(kit.jwks));
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

const create = async (tenant: TenantFixture, code: string, name: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/locations',
    headers: { ...json, ...(await tenant.auth()) },
    payload: { code, name },
  });

describe('location catalog', () => {
  it('creates, searches, pages, renames and deletes with audit, isolated per tenant', async () => {
    const first = await create(a, 'ankara-hq', 'Ankara HQ');
    expect(first.statusCode).toBe(201);
    const loc = first.json<{ id: string; version: number }>();
    expect((await create(a, 'izmir', 'Izmir Campus')).statusCode).toBe(201);
    expect((await create(a, 'ankara-hq', 'Duplicate')).statusCode).toBe(409);
    expect((await create(a, 'Bad Code', 'x')).statusCode).toBe(400);
    expect((await create(b, 'ankara-hq', 'Other tenant same code')).statusCode).toBe(201);

    const search = await app.inject({
      method: 'GET',
      url: '/v1/locations?q=izm',
      headers: await a.auth(),
    });
    expect(search.json<{ data: { code: string }[] }>().data.map((l) => l.code)).toEqual(['izmir']);
    const page = await app.inject({
      method: 'GET',
      url: '/v1/locations?limit=1',
      headers: await a.auth(),
    });
    const body = page.json<{ data: unknown[]; page: { nextCursor: string | null } }>();
    expect(body.data).toHaveLength(1);
    expect(body.page.nextCursor).not.toBeNull();
    const other = await app.inject({
      method: 'GET',
      url: '/v1/locations',
      headers: await b.auth(),
    });
    expect(other.json<{ data: { name: string }[] }>().data.map((l) => l.name)).toEqual([
      'Other tenant same code',
    ]);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/locations/${loc.id}`,
      headers: { ...json, ...(await a.auth()), 'if-match': '"1"' },
      payload: { name: 'Ankara Campus' },
    });
    expect(renamed.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/locations/${loc.id}`,
      headers: { ...json, ...(await a.auth()), 'if-match': '"1"' },
      payload: { name: 'Stale' },
    });
    expect(stale.statusCode).toBe(412);
    // Another tenant cannot touch it.
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/v1/locations/${loc.id}`,
      headers: { ...(await b.auth()), 'if-match': '"2"' },
    });
    expect(foreign.statusCode).toBe(404);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/locations/${loc.id}`,
      headers: { ...(await a.auth()), 'if-match': '"2"' },
    });
    expect(removed.statusCode).toBe(204);
    // The code can be reused once soft-deleted.
    expect((await create(a, 'ankara-hq', 'Ankara again')).statusCode).toBe(201);

    const events = await owner.auditEvent.findMany({
      where: { tenantId: a.tenantId, action: { startsWith: 'tenancy.location.' } },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((event) => event.action)).toEqual([
      'tenancy.location.created',
      'tenancy.location.created',
      'tenancy.location.updated',
      'tenancy.location.deleted',
      'tenancy.location.created',
    ]);
  });
});
