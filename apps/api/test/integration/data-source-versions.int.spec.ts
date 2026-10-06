import { afterAll, beforeAll, expect, it } from 'vitest';

import { uuidv7 } from '../../src/common/crypto/uuid.js';

import { appConnection, ownerPrisma } from './helpers.js';

const a = uuidv7(),
  b = uuidv7(),
  sourceId = uuidv7();
let owner: ReturnType<typeof ownerPrisma>, app: Awaited<ReturnType<typeof appConnection>>;
const definition = (baseUrl: string) => ({ baseUrl, endpoint: '/x', auth: { type: 'none' } });

async function asTenant<T>(tenant: string, work: (q: typeof app.query) => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    return await work(app.query.bind(app));
  } finally {
    await app.query('ROLLBACK');
  }
}

beforeAll(async () => {
  owner = ownerPrisma();
  for (const [id, slug] of [
    [a, `dsv-a-${a.slice(-8)}`],
    [b, `dsv-b-${b.slice(-8)}`],
  ] as const)
    await owner.tenant.create({
      data: {
        id,
        slug,
        name: slug,
        status: 'active',
        region: 'tr',
        settings: {},
        createdBy: 't',
        updatedBy: 't',
      },
    });
  await owner.dataSource.create({
    data: {
      id: sourceId,
      tenantId: a,
      key: 'customer',
      protocol: 'rest',
      definition: definition('https://one.test'),
      secretRefs: [],
      createdBy: 'creator',
      updatedBy: 'creator',
    },
  });
  app = await appConnection();
});
afterAll(async () => {
  await app.end();
  await owner.$executeRaw`ALTER TABLE data_source_versions DISABLE TRIGGER USER`;
  await owner.$executeRaw`DELETE FROM data_source_versions WHERE tenant_id IN (${a}::uuid,${b}::uuid)`;
  await owner.dataSource.deleteMany({ where: { tenantId: a } });
  await owner.$executeRaw`ALTER TABLE data_source_versions ENABLE TRIGGER USER`;
  await owner.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await owner.$disconnect();
});

it('snapshots create and every update in the same transaction; pins stay stable after edits', async () => {
  await owner.dataSource.update({
    where: { id: sourceId },
    data: {
      definition: definition('https://two.test'),
      version: { increment: 1 },
      updatedBy: 'editor',
    },
  });
  // Non-versioning update (soft delete flag) adds nothing.
  await owner.dataSource.update({ where: { id: sourceId }, data: { updatedBy: 'editor' } });
  const rows = await owner.dataSourceVersion.findMany({
    where: { dataSourceId: sourceId },
    orderBy: { version: 'asc' },
  });
  expect(rows.map((r) => [r.version, r.createdBy])).toEqual([
    [1, 'creator'],
    [2, 'editor'],
  ]);
  expect((rows[0]?.definition as { baseUrl: string }).baseUrl).toBe('https://one.test');
  expect((rows[1]?.definition as { baseUrl: string }).baseUrl).toBe('https://two.test');
  expect(rows[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(rows[0]?.contentHash).not.toBe(rows[1]?.contentHash);
  expect(rows[0]?.id[14]).toBe('7');
});

it('rolls the snapshot back together with a failed mutation', async () => {
  await expect(
    owner.$transaction(async (tx) => {
      await tx.dataSource.update({
        where: { id: sourceId },
        data: { version: { increment: 1 }, updatedBy: 'x' },
      });
      throw new Error('abort');
    }),
  ).rejects.toThrow('abort');
  expect(await owner.dataSourceVersion.count({ where: { dataSourceId: sourceId } })).toBe(2);
});

it('is append-only for the runtime role and for the owner', async () => {
  await asTenant(a, async (q) => {
    await expect(q("UPDATE data_source_versions SET key='x'")).rejects.toThrow(
      /permission denied|append-only/,
    );
  });
  await asTenant(a, async (q) => {
    await expect(q('DELETE FROM data_source_versions')).rejects.toThrow();
  });
  await expect(owner.$executeRaw`UPDATE data_source_versions SET key = 'x'`).rejects.toThrow();
  await expect(owner.$executeRaw`TRUNCATE data_source_versions`).rejects.toThrow();
});

it('is tenant isolated by RLS and never stores secret values', async () => {
  await asTenant(a, async (q) => {
    expect((await q('SELECT * FROM data_source_versions')).rows.length).toBeGreaterThanOrEqual(2);
  });
  await asTenant(b, async (q) => {
    expect((await q('SELECT * FROM data_source_versions')).rows).toHaveLength(0);
    await expect(
      q(
        `INSERT INTO data_source_versions(id,tenant_id,data_source_id,key,version,protocol,definition,policy,content_hash,created_by)
         VALUES($1,$2,$3,'k',9,'rest','{}','{}',repeat('a',64),'x')`,
        [uuidv7(), a, sourceId],
      ),
    ).rejects.toThrow();
  });
  // No tenant context: nothing visible.
  expect((await app.query('SELECT * FROM data_source_versions')).rows).toHaveLength(0);
  const columns = await app.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='data_source_versions'",
  );
  expect(columns.rows.map((r: { column_name: string }) => r.column_name)).not.toContain('secret');
});

it('rejects identity changes that would break existing published pins', async () => {
  await expect(
    owner.dataSource.update({
      where: { id: sourceId },
      data: { key: 'renamed', version: { increment: 1 } },
    }),
  ).rejects.toThrow('identity is immutable');
  await expect(
    owner.dataSource.update({
      where: { id: sourceId },
      data: { tenantId: b, version: { increment: 1 } },
    }),
  ).rejects.toThrow('identity is immutable');
});
