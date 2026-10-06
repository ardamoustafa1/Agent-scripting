import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const API_DIR = path.resolve(import.meta.dirname, '../..');
const prisma = path.join(API_DIR, 'node_modules/.bin/prisma');
let owner: pg.Client;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: inject('pgOwnerUrl') });
  await owner.connect();
});
afterAll(async () => {
  await owner.end();
});

/** Tables that are only ENABLE (not FORCE) RLS because SECURITY DEFINER functions read them. */
const NOT_FORCED = ['tenants', 'outbox_events', 'audit_archives'];
/** Reviewed SQL objects Prisma cannot model (ADR-0014): partitions, the v1 audit copy, the policy row. */
const PRISMA_UNMODELLED =
  /(audit_events|session_events)_(y\d{4}m\d{2}|default)|audit_events_v1|audit_policy|audit_events_search_idx|"search"/;

describe('migrations', () => {
  it('apply cleanly to an empty database', async () => {
    expect(inject('migrateOutput')).toContain('All migrations have been successfully applied');
    const { rows } = await owner.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
    );
    expect(rows.map((row) => row.migration_name)).toEqual([
      '20261001000000_init',
      '20261001010000_domain_model',
      '20261001020000_tenant_isolation',
      '20261001030000_identity',
      '20261001040000_identity_isolation',
      '20261001050000_authz_casl',
      '20261001060000_audit_v2',
      '20261001070000_authoring_routing',
      '20261001080000_runtime',
      '20261001090000_secure_launch',
      '20261002090000_team_authoring',
      '20261003120000_admin_workspace',
      '20261003150000_analytics',
      '20261003180000_ai',
      '20261003210000_observability',
      '20261006103000_runtime_resilience',
    ]);
    expect(rows.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true);
  });

  it('are idempotent (re-deploy is a no-op)', () => {
    const output = execFileSync(prisma, ['migrate', 'deploy'], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: inject('pgOwnerUrl') },
      encoding: 'utf8',
    });
    expect(output).toContain('No pending migrations to apply');
  });

  it('leave no drift between the database and schema.prisma', () => {
    const result = spawnSync(
      prisma,
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--script',
      ],
      {
        cwd: API_DIR,
        env: { ...process.env, DATABASE_URL: inject('pgOwnerUrl') },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    // Statements are separated by blank lines; drop the ones about reviewed, unmodelled objects.
    const drift = result.stdout
      .split(/\n\s*\n/)
      .map((statement) => statement.trim())
      .filter(
        (statement) => /CREATE|ALTER|DROP/.test(statement) && !PRISMA_UNMODELLED.test(statement),
      );
    expect(drift).toEqual([]);
  });
});

describe('isolation catalogue', () => {
  it('every table has RLS with a tenant policy (forced unless documented)', async () => {
    const { rows } = await owner.query<{
      table: string;
      rls: boolean;
      forced: boolean;
      policies: string[];
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             coalesce(array_agg(p.qual) FILTER (WHERE p.qual IS NOT NULL), '{}') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND c.relname NOT IN ('_prisma_migrations', 'audit_policy')
       GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
       ORDER BY c.relname`);
    expect(rows.length).toBe(57);
    for (const row of rows) {
      expect(row.rls, row.table).toBe(true);
      expect(row.forced, row.table).toBe(!NOT_FORCED.includes(row.table));
      expect(row.policies.length, row.table).toBeGreaterThan(0);
      const directTenantPolicy =
        "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)";
      expect(
        row.policies.some(
          (policy) =>
            policy.includes('app_current_tenant()') ||
            policy === directTenantPolicy ||
            policy === "(tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)",
        ),
        row.table,
      ).toBe(true);
    }
  });

  it('every tenant-owned table has tenant_id', async () => {
    const { rows } = await owner.query<{ table: string }>(`
      SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND c.relname NOT IN ('_prisma_migrations', 'tenants', 'audit_policy')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_name = c.relname AND col.column_name = 'tenant_id')`);
    expect(rows).toEqual([]);
  });

  it('the runtime role is least privilege', async () => {
    const { rows } = await owner.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      owned: string;
    }>(`
      SELECT rolsuper, rolbypassrls, rolcreaterole,
             (SELECT count(*) FROM pg_tables WHERE tableowner = 'verbis_app')::text AS owned
        FROM pg_roles WHERE rolname = 'verbis_app'`);
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      owned: '0',
    });
    const grants = await owner.query<{ table_name: string; privilege_type: string }>(`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'verbis_app' AND privilege_type IN ('DELETE', 'TRUNCATE', 'UPDATE')
         AND table_name IN ('audit_events', 'session_events', 'outbox_events', 'processed_events')`);
    expect(grants.rows).toEqual([]);
  });

  it('audit partitions have RLS enabled and no grants for runtime roles', async () => {
    const { rows } = await owner.query<{ name: string; rls: boolean; granted: boolean }>(`
      SELECT c.relname AS name, c.relrowsecurity AS rls,
             has_table_privilege('verbis_app', c.oid, 'SELECT') OR has_table_privilege('verbis_audit_worker', c.oid, 'SELECT') AS granted
        FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname IN ('audit_events', 'session_events')`);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      expect(row.rls, row.name).toBe(true);
      expect(row.granted, row.name).toBe(false);
    }
  });

  it('SECURITY DEFINER functions pin search_path and are not callable by PUBLIC', async () => {
    const { rows } = await owner.query<{
      name: string;
      config: string[] | null;
      public_exec: boolean;
    }>(`
      SELECT p.proname AS name, p.proconfig AS config, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public' WHERE p.prosecdef`);
    expect(rows.map((row) => row.name).sort()).toEqual([
      'admin_platform_actor',
      'admin_tenant_list',
      'admin_tenant_write',
      'analytics_active_tenants',
      'audit_active_tenants',
      'audit_drop_partition',
      'audit_ensure_partitions',
      'identity_discover_domain',
      'operational_active_sessions',
      'outbox_claim',
      'outbox_mark_failed',
      'outbox_mark_published',
      'outbox_purge_published',
      'outbox_requeue',
      'tenant_origin_allowed',
      'tenant_resolve',
    ]);
    for (const row of rows) {
      const searchPath = ['analytics_active_tenants', 'operational_active_sessions'].includes(
        row.name,
      )
        ? 'search_path=pg_catalog, public'
        : 'search_path=public, pg_temp';
      expect(row.config, row.name).toContain(searchPath);
      expect(row.public_exec, row.name).toBe(false);
    }
  });
});
