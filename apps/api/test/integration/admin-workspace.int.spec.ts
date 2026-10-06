import { beforeAll, afterAll, describe, it, expect } from 'vitest';

import { appConnection, ownerPrisma, uniqueSlug } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type pg from 'pg';

let owner: PrismaClient,
  app: pg.Client,
  platform: string,
  other: string,
  userId: string,
  basicId: string;
async function scope<T>(id: string, fn: () => Promise<T>) {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.tenant_id',$1,true)", [id]);
    return await fn();
  } finally {
    await app.query('ROLLBACK');
  }
}
beforeAll(async () => {
  owner = ownerPrisma();
  app = await appConnection();
  const first = await owner.tenant.create({
    data: {
      slug: uniqueSlug('admin-platform'),
      name: 'Platform fixture',
      region: 'tr',
      status: 'active',
      settings: { platform: true },
    },
  });
  platform = first.id;
  other = (
    await owner.tenant.create({
      data: {
        slug: uniqueSlug('admin-other'),
        name: 'Other fixture',
        region: 'tr',
        status: 'active',
      },
    })
  ).id;
  userId = (
    await owner.user.create({
      data: {
        tenantId: platform,
        email: `${uniqueSlug('admin')}@example.test`,
        displayName: 'Fixture',
        status: 'active',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  ).id;
  basicId = (
    await owner.user.create({
      data: {
        tenantId: platform,
        email: `${uniqueSlug('basic')}@example.test`,
        displayName: 'Fixture',
        status: 'active',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  ).id;
  const role = await owner.role.create({
    data: {
      tenantId: platform,
      name: 'super_admin',
      isSystem: true,
      permissions: ['manage:all'],
      rules: [{ action: 'manage', subject: 'all' }],
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  await owner.userRole.create({
    data: { tenantId: platform, userId, roleId: role.id, createdBy: 'test', updatedBy: 'test' },
  });
});
afterAll(async () => {
  await app.end();
  await owner.$disconnect();
});
describe('admin control plane isolation', () => {
  it('refuses a non-platform tenant even with a platform actor id', async () => {
    await expect(
      scope(other, () => app.query('SELECT admin_tenant_list($1::uuid)', [userId])),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('refuses a platform tenant user without the platform role', async () => {
    await expect(
      scope(platform, () => app.query('SELECT admin_tenant_list($1::uuid)', [basicId])),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('fences a cross-tenant update and preserves the tenant RLS context', async () => {
    await expect(
      scope(platform, () =>
        app.query('SELECT admin_tenant_write($1::uuid,$2::uuid,$3::jsonb,999999)', [
          userId,
          other,
          JSON.stringify({
            name: 'Changed',
            region: 'tr',
            status: 'active',
            quotas: { maxUsers: 1, maxScripts: 1, maxActiveSessions: 1 },
            features: {},
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: '40001' });
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: other } })).name).toBe(
      'Other fixture',
    );
  });
  it('forces RLS on privacy requests', async () => {
    const result = await app.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='admin_privacy_requests'::regclass",
    );
    expect(result.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const rows = await scope(other, () =>
      app.query('SELECT id FROM admin_privacy_requests WHERE tenant_id=$1::uuid', [platform]),
    );
    expect(rows.rows).toEqual([]);
  });
});
