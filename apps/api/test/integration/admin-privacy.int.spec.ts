import { afterAll, beforeAll, expect, it } from 'vitest';

import { RuntimeCipher } from '../../src/modules/runtime/runtime-cipher.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
  type TenantFixture,
} from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let kit: TokenKit,
  owner: PrismaClient,
  app: NestFastifyApplication,
  tenant: TenantFixture,
  other: TenantFixture;
beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  tenant = await createTenant(owner, kit, uniqueSlug('privacy-a'));
  other = await createTenant(owner, kit, uniqueSlug('privacy-b'), { audit: { legalHold: true } });
  app = await startApp(integrationEnv(kit.jwks));
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});
const path = '/v1/admin/privacy-requests';
async function create(kind: 'search' | 'export' | 'anonymize', who = tenant) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { ...(await who.auth()), 'content-type': 'application/json' },
    payload: {
      kind,
      subject: 'synthetic-subject',
      reason: 'Synthetic verified request',
      verified: true,
    },
  });
}
it.each(['search', 'export', 'anonymize'] as const)(
  'encrypts, processes and audits a local %s request with real PostgreSQL',
  async (kind) => {
    const created = await create(kind);
    expect(created.statusCode).toBe(201);
    const result = created.json<{ id: string; version: number }>();
    const rows = await owner.$queryRaw<
      { subject_sealed: string; reason: string }[]
    >`SELECT subject_sealed,reason FROM admin_privacy_requests WHERE id=${result.id}::uuid`;
    const cipher = app.get(RuntimeCipher);
    expect(rows[0]!.subject_sealed).not.toContain('synthetic-subject');
    expect(
      cipher.openString(rows[0]!.subject_sealed, `runtime:privacy:${tenant.tenantId}:${result.id}`),
    ).toBe('synthetic-subject');
    expect(
      cipher.openString(rows[0]!.reason, `runtime:privacyReason:${tenant.tenantId}:${result.id}`),
    ).toBe('Synthetic verified request');
    const processed = await app.inject({
      method: 'POST',
      url: `${path}/${result.id}/process`,
      headers: { ...(await tenant.auth()), 'content-type': 'application/json', 'if-match': '"1"' },
      payload: { confirmRequestId: result.id },
    });
    expect(processed.statusCode).toBe(201);
    expect(processed.json()).toMatchObject({ state: 'completed', version: 2, count: 0 });
    if (kind === 'export') {
      const exported = await app.inject({
        method: 'GET',
        url: `${path}/${result.id}/export`,
        headers: await tenant.auth(),
      });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['cache-control']).toContain('no-store');
      expect(exported.json()).toEqual({ requestId: result.id, records: [] });
    }
    const listed = await app.inject({ method: 'GET', url: path, headers: await tenant.auth() });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers['cache-control']).toContain('no-store');
    expect(listed.body).not.toContain('synthetic-subject');
  },
);
it('enforces tenant isolation, permission checks and optimistic confirmation before processing', async () => {
  const created = (await create('search')).json<{ id: string }>();
  expect(
    (await app.inject({ method: 'GET', url: path, headers: await tenant.auth(tenant.designerId) }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: `${path}/${created.id}/export`,
        headers: await other.auth(),
      })
    ).statusCode,
  ).toBe(404);
  const process = (headers: Record<string, string>, confirmRequestId = created.id) =>
    app.inject({
      method: 'POST',
      url: `${path}/${created.id}/process`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { confirmRequestId },
    });
  const auth = await tenant.auth();
  expect((await process(auth)).statusCode).toBe(428);
  expect((await process({ ...auth, 'if-match': '"99"' })).statusCode).toBe(412);
  expect((await process({ ...auth, 'if-match': '"1"' }, other.adminId)).statusCode).toBe(409);
});
it('rejects anonymization under a legal hold without completing the request', async () => {
  const created = (await create('anonymize', other)).json<{ id: string }>();
  const result = await app.inject({
    method: 'POST',
    url: `${path}/${created.id}/process`,
    headers: { ...(await other.auth()), 'content-type': 'application/json', 'if-match': '"1"' },
    payload: { confirmRequestId: created.id },
  });
  expect(result.statusCode).toBe(409);
  const rows = await owner.$queryRaw<
    { state: string; version: number }[]
  >`SELECT state,version FROM admin_privacy_requests WHERE id=${created.id}::uuid`;
  expect(rows).toEqual([{ state: 'pending', version: 1 }]);
});
