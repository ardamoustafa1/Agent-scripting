import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appConnection, ownerPrisma, uniqueSlug } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type pg from 'pg';

let owner: PrismaClient;
let app: pg.Client;
const t = { a: '', b: '' };
const campaign = { a: '', b: '' };

/** Runs statements as verbis_app inside a transaction with app.tenant_id set (or not). */
async function asTenant<T>(
  tenantId: string | null,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  await app.query('BEGIN');
  try {
    if (tenantId !== null)
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(app);
  } finally {
    await app.query('ROLLBACK');
  }
}

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  owner = ownerPrisma();
  app = await appConnection();
  for (const key of ['a', 'b'] as const) {
    const tenant = await owner.tenant.create({
      data: {
        slug: uniqueSlug(`rls-${key}`),
        name: key,
        region: 'tr-1',
        status: 'active',
        settings: { allowedOrigins: [`https://${key}.rls.example`] },
      },
    });
    t[key] = tenant.id;
    const row = await owner.campaign.create({
      data: { tenantId: tenant.id, name: `campaign-${key}`, createdBy: 'test', updatedBy: 'test' },
    });
    campaign[key] = row.id;
    await owner.outboxEvent.create({
      data: {
        tenantId: tenant.id,
        aggregateType: 'Campaign',
        aggregateId: row.id,
        eventType: 'verbis.campaigns.campaign.created.v1',
        payload: {},
        createdBy: 'test',
        status: 'published',
      },
    });
    await owner.auditEvent.create({
      data: {
        id: `01J${String(Math.random()).slice(2, 25).padEnd(23, '0')}`.slice(0, 26),
        recordedAt: new Date(),
        tenantId: tenant.id,
        seq: 1n,
        action: 'campaign.campaign.created',
        actorType: 'user',
        actorId: 'u',
        actor: {},
        targetType: 'Campaign',
        targetId: row.id,
        outcome: 'success',
        correlationId: 'c',
        occurredAt: new Date(),
        prevHash: '0'.repeat(64),
        hash: 'a'.repeat(64),
      },
    });
  }
});

afterAll(async () => {
  await app.end();
  await owner.$disconnect();
});

describe('Row-Level Security: another tenant’s data is unreachable', () => {
  it('without a tenant context nothing is visible and nothing can be written', async () => {
    await asTenant(null, async (client) => {
      expect((await client.query('SELECT count(*)::int AS n FROM campaigns')).rows[0]).toEqual({
        n: 0,
      });
      expect((await client.query('SELECT count(*)::int AS n FROM tenants')).rows[0]).toEqual({
        n: 0,
      });
      expect(
        await sqlState(
          client.query(
            "INSERT INTO campaigns (id, tenant_id, name, created_by, updated_by, updated_at) VALUES (gen_random_uuid(), $1, 'x', 't', 't', now())",
            [t.a],
          ),
        ),
      ).toBe('42501');
    });
  });

  it('a tenant sees exactly its own rows, in every tenant-scoped table queried', async () => {
    await asTenant(t.a, async (client) => {
      expect(
        (await client.query<{ id: string }>('SELECT id FROM campaigns')).rows.map((row) => row.id),
      ).toEqual([campaign.a]);
      expect(
        (await client.query<{ id: string }>('SELECT id FROM tenants')).rows.map((row) => row.id),
      ).toEqual([t.a]);
      for (const table of ['outbox_events', 'audit_events']) {
        const { rows } = await client.query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id FROM ${table}`,
        );
        expect(
          rows.map((row) => row.tenant_id),
          table,
        ).toEqual([t.a]);
      }
    });
  });

  it('cannot read another tenant’s row even by primary key', async () => {
    await asTenant(t.a, async (client) => {
      expect(
        (await client.query('SELECT * FROM campaigns WHERE id = $1', [campaign.b])).rowCount,
      ).toBe(0);
      expect(
        (await client.query('SELECT * FROM campaigns WHERE tenant_id = $1', [t.b])).rowCount,
      ).toBe(0);
      expect((await client.query('SELECT * FROM tenants WHERE id = $1', [t.b])).rowCount).toBe(0);
    });
  });

  it('cannot update or soft-delete another tenant’s rows', async () => {
    await asTenant(t.a, async (client) => {
      expect(
        (await client.query("UPDATE campaigns SET name = 'pwned' WHERE id = $1", [campaign.b]))
          .rowCount,
      ).toBe(0);
      expect(
        (await client.query('UPDATE campaigns SET deleted_at = now() WHERE tenant_id = $1', [t.b]))
          .rowCount,
      ).toBe(0);
      expect(
        (await client.query("UPDATE tenants SET name = 'pwned' WHERE id = $1", [t.b])).rowCount,
      ).toBe(0);
    });
    const untouched = await owner.campaign.findUniqueOrThrow({ where: { id: campaign.b } });
    expect(untouched).toMatchObject({ name: 'campaign-b', deletedAt: null });
  });

  it('cannot insert into, or move a row to, another tenant', async () => {
    await asTenant(t.a, async (client) => {
      const insert = client.query(
        "INSERT INTO campaigns (id, tenant_id, name, created_by, updated_by, updated_at) VALUES (gen_random_uuid(), $1, 'smuggled', 't', 't', now())",
        [t.b],
      );
      expect(await sqlState(insert)).toBe('42501');
    });
    await asTenant(t.a, async (client) => {
      expect(
        await sqlState(
          client.query('UPDATE campaigns SET tenant_id = $1 WHERE id = $2', [t.b, campaign.a]),
        ),
      ).toBe('42501');
    });
    await asTenant(t.a, async (client) => {
      const outbox = client.query(
        "INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, created_by) VALUES (gen_random_uuid(), $1, 'x', 'x', 'verbis.campaigns.x.y.v1', '{}', 't')",
        [t.b],
      );
      expect(await sqlState(outbox)).toBe('42501');
    });
  });

  it('the runtime role cannot switch RLS off, change roles or alter tables', async () => {
    await asTenant(t.a, async (client) => {
      await client.query('SET LOCAL row_security = off');
      // With row_security off, any query that RLS would filter raises instead of bypassing.
      expect(await sqlState(client.query('SELECT * FROM campaigns'))).toBe('42501');
    });
    await asTenant(t.a, async (client) => {
      expect(await sqlState(client.query('SET LOCAL ROLE verbis_owner'))).toBe('42501');
    });
    await asTenant(t.a, async (client) => {
      expect(await sqlState(client.query('ALTER TABLE campaigns DISABLE ROW LEVEL SECURITY'))).toBe(
        '42501',
      );
    });
    await asTenant(t.a, async (client) => {
      expect(await sqlState(client.query('DROP POLICY tenant_isolation ON campaigns'))).toBe(
        '42501',
      );
    });
  });

  it('switching the context mid-transaction never mixes tenants', async () => {
    await asTenant(t.a, async (client) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.b]);
      expect(
        (await client.query<{ id: string }>('SELECT id FROM campaigns')).rows.map((row) => row.id),
      ).toEqual([campaign.b]);
      await client.query("SELECT set_config('app.tenant_id', '', true)");
      expect((await client.query('SELECT id FROM campaigns')).rowCount).toBe(0);
    });
  });

  it('a malformed tenant context fails closed with an error', async () => {
    await asTenant('not-a-uuid', async (client) => {
      expect(await sqlState(client.query('SELECT * FROM campaigns'))).toBe('22P02');
    });
  });

  it('SET LOCAL does not leak to the next transaction on the same connection', async () => {
    await asTenant(t.a, async (client) => {
      expect((await client.query('SELECT count(*)::int AS n FROM campaigns')).rows[0]).toEqual({
        n: 1,
      });
    });
    expect((await app.query('SELECT count(*)::int AS n FROM campaigns')).rows[0]).toEqual({ n: 0 });
  });
});

describe('append-only audit trail', () => {
  it('the runtime role has no UPDATE/DELETE privilege', async () => {
    await asTenant(t.a, async (client) => {
      expect(await sqlState(client.query("UPDATE audit_events SET action = 'x'"))).toBe('42501');
    });
    await asTenant(t.a, async (client) => {
      expect(await sqlState(client.query('DELETE FROM audit_events'))).toBe('42501');
    });
  });

  it('even the owner cannot update, delete or truncate (trigger)', async () => {
    await expect(owner.$executeRaw`UPDATE audit_events SET action = 'tampered'`).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.$executeRaw`DELETE FROM audit_events`).rejects.toThrow(/append-only/);
    await expect(owner.$executeRaw`TRUNCATE audit_events`).rejects.toThrow(/append-only/);
  });
});

describe('system functions', () => {
  it('outbox_claim leases events across tenants without exposing the table', async () => {
    await owner.outboxEvent.updateMany({
      where: { tenantId: { in: [t.a, t.b] } },
      data: { status: 'pending', availableAt: new Date(0) },
    });
    const { rows } = await app.query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM outbox_claim(500, 30)',
    );
    try {
      // Other suites may have pending events too; both tenants must be among the claimed rows.
      const tenants = new Set(rows.map((row) => row.tenant_id));
      expect(tenants.has(t.a) && tenants.has(t.b)).toBe(true);
      // Leased rows are skipped by a concurrent relay.
      expect(
        (
          await app.query('SELECT * FROM outbox_claim(500, 30) WHERE tenant_id = ANY($1)', [
            [t.a, t.b],
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      // Release every lease taken here so other suites' relays are not delayed.
      await owner.outboxEvent.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { lockedUntil: null },
      });
      await owner.outboxEvent.updateMany({
        where: { tenantId: { in: [t.a, t.b] } },
        data: { status: 'published' },
      });
    }
  });

  it('outbox_requeue only touches the caller’s tenant', async () => {
    const dead = await owner.outboxEvent.create({
      data: {
        tenantId: t.b,
        aggregateType: 'X',
        aggregateId: 'x',
        eventType: 'verbis.campaigns.x.y.v1',
        payload: {},
        createdBy: 't',
        status: 'dead',
      },
    });
    await asTenant(t.a, async (client) => {
      expect((await client.query('SELECT outbox_requeue($1) AS ok', [dead.id])).rows[0]).toEqual({
        ok: false,
      });
    });
    expect((await owner.outboxEvent.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe(
      'dead',
    );
  });

  it('tenant_origin_allowed answers a boolean without revealing tenants', async () => {
    expect(
      (await app.query('SELECT tenant_origin_allowed($1) AS ok', ['https://a.rls.example']))
        .rows[0],
    ).toEqual({ ok: true });
    expect(
      (await app.query('SELECT tenant_origin_allowed($1) AS ok', ['https://evil.example'])).rows[0],
    ).toEqual({ ok: false });
  });
});

describe('identity tables and pre-tenant lookups', () => {
  const slugs = { a: '', b: '' };
  const domains = { a: '', b: '' };

  beforeAll(async () => {
    for (const key of ['a', 'b'] as const) {
      const tenantId = t[key];
      slugs[key] = (await owner.tenant.findUniqueOrThrow({ where: { id: tenantId } })).slug;
      const by = { createdBy: 'test', updatedBy: 'test' };
      const user = await owner.user.create({
        data: { tenantId, email: `u@${key}.rls.test`, displayName: key, status: 'active', ...by },
      });
      const idp = await owner.identityProvider.create({
        data: {
          tenantId,
          protocol: 'oidc',
          displayName: key,
          status: 'active',
          domainHints: [],
          ...by,
        },
      });
      domains[key] = `${slugs[key]}.rls.test`;
      await owner.identityProviderDomain.create({
        data: { tenantId, idpId: idp.id, domain: domains[key], ...by },
      });
      await owner.userIdentity.create({
        data: { tenantId, userId: user.id, idpId: idp.id, subject: `sub-${key}`, ...by },
      });
      const group = await owner.group.create({
        data: { tenantId, idpId: idp.id, displayName: `g-${key}`, ...by },
      });
      await owner.groupMember.create({
        data: { tenantId, groupId: group.id, userId: user.id, ...by },
      });
      await owner.scimToken.create({
        data: {
          tenantId,
          idpId: idp.id,
          tokenHash: (key === 'a' ? 'a' : 'b').repeat(64),
          prefix: 'vscim_x',
          ...by,
        },
      });
      await owner.serviceClient.create({
        data: {
          tenantId,
          name: `svc-${key}`,
          authMethod: 'client_secret_basic',
          secretHash: 'c'.repeat(64),
          scopes: ['read:Session'],
          ...by,
        },
      });
      await owner.localCredential.create({
        data: {
          tenantId,
          userId: user.id,
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$x$y',
          totpSecret: 'sealed',
          ...by,
        },
      });
    }
  });

  it('every identity table is confined to the current tenant', async () => {
    await asTenant(t.a, async (client) => {
      for (const table of [
        'user_identities',
        'identity_provider_domains',
        'groups',
        'group_members',
        'scim_tokens',
        'service_clients',
        'local_credentials',
      ]) {
        const { rows } = await client.query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id FROM ${table}`,
        );
        expect(
          rows.map((row) => row.tenant_id),
          table,
        ).toEqual([t.a]);
      }
    });
    await asTenant(null, async (client) => {
      expect((await client.query('SELECT 1 FROM local_credentials')).rows).toEqual([]);
    });
  });

  it('a claimed email domain is unique across tenants', async () => {
    const idp = await owner.identityProvider.findFirstOrThrow({ where: { tenantId: t.b } });
    await expect(
      owner.identityProviderDomain.create({
        data: { tenantId: t.b, idpId: idp.id, domain: domains.a, createdBy: 'x', updatedBy: 'x' },
      }),
    ).rejects.toThrow();
  });

  it('tenant_resolve and identity_discover_domain answer only what login needs', async () => {
    expect((await app.query('SELECT id, status FROM tenant_resolve($1)', [slugs.a])).rows).toEqual([
      { id: t.a, status: 'active' },
    ]);
    expect((await app.query('SELECT id FROM tenant_resolve($1)', ['no-such-tenant'])).rows).toEqual(
      [],
    );
    const realm = await app.query<{ tenant_id: string; tenant_slug: string }>(
      'SELECT tenant_id, tenant_slug FROM identity_discover_domain($1)',
      [domains.b.toUpperCase()],
    );
    expect(realm.rows.map((row) => [row.tenant_id, row.tenant_slug])).toEqual([[t.b, slugs.b]]);
    expect(
      (await app.query('SELECT * FROM identity_discover_domain($1)', ['unknown.example'])).rows,
    ).toEqual([]);
  });
});
