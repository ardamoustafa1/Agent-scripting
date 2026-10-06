import { randomUUID } from 'node:crypto';

import { beforeAll, afterAll, expect, it } from 'vitest';

import { ownerPrisma, appConnection } from './helpers.js';

const owner = ownerPrisma();
let app: Awaited<ReturnType<typeof appConnection>>;
const a = randomUUID(),
  b = randomUUID();
beforeAll(async () => {
  for (const id of [a, b])
    await owner.tenant.create({
      data: {
        id,
        slug: 'ai-' + id,
        name: 'AI fixture',
        region: 'tr',
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
  app = await appConnection();
});
afterAll(async () => {
  await app.end();
  await owner.$executeRaw`DELETE FROM ai_calls WHERE tenant_id IN (${a}::uuid,${b}::uuid)`;
  await owner.$executeRaw`DELETE FROM ai_usage WHERE tenant_id IN (${a}::uuid,${b}::uuid)`;
  await owner.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await owner.$disconnect();
});
it('tenant RLS hides usage without context and forbids crossing the tenant boundary', async () => {
  await app.query('BEGIN');
  await app.query("SELECT set_config('app.tenant_id',$1,true)", [a]);
  await app.query("INSERT INTO ai_usage(tenant_id,month) VALUES($1,'2026-10-01')", [a]);
  await app.query('COMMIT');
  expect((await app.query('SELECT * FROM ai_usage')).rows).toHaveLength(0);
  await app.query('BEGIN');
  await app.query("SELECT set_config('app.tenant_id',$1,true)", [b]);
  expect((await app.query('SELECT * FROM ai_usage')).rows).toHaveLength(0);
  await expect(
    app.query("INSERT INTO ai_usage(tenant_id,month) VALUES($1,'2026-10-01')", [a]),
  ).rejects.toThrow();
  await app.query('ROLLBACK');
});
it('atomic reservations cannot exceed a quota under concurrent transactions', async () => {
  const first = await appConnection(),
    second = await appConnection();
  const reserve = async (connection: typeof first) => {
    await connection.query('BEGIN');
    try {
      await connection.query("SELECT set_config('app.tenant_id',$1,true)", [a]);
      await connection.query(
        "INSERT INTO ai_usage(tenant_id,month) VALUES($1,'2026-11-01') ON CONFLICT DO NOTHING",
        [a],
      );
      const result = await connection.query(
        "UPDATE ai_usage SET tokens=tokens+60 WHERE tenant_id=$1 AND month='2026-11-01' AND tokens+60<=100 RETURNING tokens",
        [a],
      );
      await connection.query('COMMIT');
      return result.rowCount;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    }
  };
  try {
    const rows = await Promise.all([reserve(first), reserve(second)]);
    expect(rows.reduce<number>((sum, count) => sum + (count ?? 0), 0)).toBe(1);
  } finally {
    await first.end();
    await second.end();
  }
});
