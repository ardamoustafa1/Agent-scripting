import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appConnection, ownerPrisma } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type pg from 'pg';

let owner: PrismaClient;
let app: pg.Client;
beforeAll(async () => {
  owner = ownerPrisma();
  app = await appConnection();
});
afterAll(async () => {
  await app.end();
  await owner.$disconnect();
});
describe('count-only operational database boundary', () => {
  it('exports a count while the unscoped app still cannot read sessions', async () => {
    const aggregate = await app.query<{ count: string }>(
      'SELECT operational_active_sessions() AS count',
    );
    expect(Number(aggregate.rows[0]?.count)).toBeGreaterThanOrEqual(0);
    expect((await app.query('SELECT id FROM sessions LIMIT 1')).rows).toEqual([]);
  });
  it('retains FORCE RLS and restricts the monitoring role to non-identifying columns', async () => {
    const rows = await owner.$queryRaw<
      { force: boolean; identifiers: boolean; state: boolean; publicExecute: boolean }[]
    >`
      SELECT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.sessions'::regclass) AS force,
      has_column_privilege('verbis_metrics_reader','public.sessions','id','SELECT') AS identifiers,
      has_column_privilege('verbis_metrics_reader','public.sessions','state','SELECT') AS state,
      EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
        WHERE p.oid='public.operational_active_sessions()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute"`;
    expect(rows[0]).toEqual({ force: true, identifiers: false, state: true, publicExecute: false });
  });
});
