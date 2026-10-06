import { randomUUID } from 'node:crypto';

import { beforeAll, afterAll, expect, it } from 'vitest';

import { fixtureFact } from '../../src/modules/analytics/fixtures.js';

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
        slug: 'analytics-' + id,
        name: 'Analytics fixture',
        region: 'tr',
        createdBy: 'test',
        updatedBy: 'test',
      },
    });
  app = await appConnection();
});
afterAll(async () => {
  await app.end();
  await owner.$executeRaw`DELETE FROM analytics_facts WHERE tenant_id IN (${a}::uuid,${b}::uuid)`;
  await owner.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await owner.$disconnect();
});
it('FORCE RLS rejects cross-tenant insert and hides facts without a tenant context', async () => {
  const f = fixtureFact(0, { tenantId: a });
  await app.query('BEGIN');
  await app.query("SELECT set_config('app.tenant_id',$1,true)", [a]);
  await app.query(
    'INSERT INTO analytics_facts(tenant_id,event_id,occurred_at,session_id,fact) VALUES($1,$2,$3,$4,$5)',
    [a, f.eventId, f.at, f.sessionId, JSON.stringify(f)],
  );
  await app.query('COMMIT');
  expect((await app.query('SELECT * FROM analytics_facts')).rows).toHaveLength(0);
  await app.query('BEGIN');
  await app.query("SELECT set_config('app.tenant_id',$1,true)", [b]);
  expect((await app.query('SELECT * FROM analytics_facts')).rows).toHaveLength(0);
  await expect(
    app.query(
      'INSERT INTO analytics_facts(tenant_id,event_id,occurred_at,session_id,fact) VALUES($1,$2,$3,$4,$5)',
      [a, randomUUID(), f.at, f.sessionId, JSON.stringify(f)],
    ),
  ).rejects.toThrow();
  await app.query('ROLLBACK');
});
