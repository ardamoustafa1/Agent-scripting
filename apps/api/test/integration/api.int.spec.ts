import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BROKEN_FIXTURES,
  creditCardSalesScript,
  legacyDraftScript,
  surveyScript,
} from '@verbis/script-schema/fixtures';

import { GENESIS_HASH, recomputeHash } from '../../src/modules/audit/core/audit-event.js';
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
  a = await createTenant(owner, kit, uniqueSlug('api-a'), {
    allowedOrigins: ['https://agents.acme.example'],
  });
  b = await createTenant(owner, kit, uniqueSlug('api-b'));
  app = await startApp(
    integrationEnv(kit.jwks, { SCRIPT_DOCUMENT_COMPRESSION_THRESHOLD_BYTES: '12000' }),
  );
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

async function createCampaign(
  tenant: TenantFixture,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/campaigns',
    headers: { ...json, ...(await tenant.auth()), ...extra },
    payload: body,
  });
}

describe('campaigns: CRUD with optimistic locking and soft delete', () => {
  it('creates, reads, updates and deletes', async () => {
    const created = await createCampaign(a, {
      name: 'Retention Q4',
      channels: ['voice', 'chat'],
      queues: ['retention'],
    });
    expect(created.statusCode).toBe(201);
    const campaign = created.json<{ id: string; version: number; status: string }>();
    expect(campaign).toMatchObject({
      name: 'Retention Q4',
      status: 'draft',
      defaultLocale: 'tr',
      version: 1,
      channels: ['voice', 'chat'],
    });
    expect(created.headers.location).toBe(`/v1/campaigns/${campaign.id}`);
    expect(created.headers.etag).toBe('"1"');

    const auth = await a.auth();
    const read = await app.inject({
      method: 'GET',
      url: `/v1/campaigns/${campaign.id}`,
      headers: auth,
    });
    expect(read.json()).toEqual(campaign);

    const missingPrecondition = await app.inject({
      method: 'PATCH',
      url: `/v1/campaigns/${campaign.id}`,
      headers: { ...json, ...auth },
      payload: { status: 'active' },
    });
    expect(missingPrecondition.statusCode).toBe(428);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/campaigns/${campaign.id}`,
      headers: { ...json, ...auth, 'if-match': '"1"' },
      payload: { status: 'active' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ status: 'active', version: 2 });
    expect(updated.headers.etag).toBe('"2"');

    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/campaigns/${campaign.id}`,
      headers: { ...json, ...auth, 'if-match': '"1"' },
      payload: { status: 'paused' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ code: 'VERBIS_CONCURRENCY_VERSION_MISMATCH' });
    expect(stale.headers.etag).toBe('"2"');

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/campaigns/${campaign.id}`,
          headers: { ...auth, 'if-match': '"2"' },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/campaigns/${campaign.id}`, headers: auth }))
        .statusCode,
    ).toBe(404);
    const row = await owner.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.updatedBy).toBe(`user:${a.adminId}`);
  });

  it('validates input with RFC 7807 errors', async () => {
    const res = await createCampaign(a, { name: '', channels: ['fax'], unknown: true });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string; errors: { path: string }[] }>()).toMatchObject({
      code: 'VERBIS_VALIDATION_FAILED',
    });
    expect(res.json<{ errors: { path: string }[] }>().errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(['/body/name', '/body/channels/0', '/body']),
    );
    const window = await createCampaign(a, {
      name: 'Window',
      startsAt: '2026-10-02T00:00:00Z',
      endsAt: '2026-10-01T00:00:00Z',
    });
    expect(window.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('/body/endsAt');
  });

  it('enforces unique active names but frees them after soft delete', async () => {
    const first = (await createCampaign(a, { name: 'Unique Name' })).json<{ id: string }>();
    const duplicate = await createCampaign(a, { name: 'Unique Name' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'VERBIS_RESOURCE_CONFLICT' });
    // Same name in another tenant is fine.
    expect((await createCampaign(b, { name: 'Unique Name' })).statusCode).toBe(201);
    await app.inject({
      method: 'DELETE',
      url: `/v1/campaigns/${first.id}`,
      headers: { ...(await a.auth()), 'if-match': '"1"' },
    });
    expect((await createCampaign(a, { name: 'Unique Name' })).statusCode).toBe(201);
  });
});

describe('tenant isolation over HTTP (application layer + RLS)', () => {
  it('another tenant can neither see nor change a campaign', async () => {
    const campaign = (await createCampaign(a, { name: 'Private A' })).json<{ id: string }>();
    const auth = await b.auth();
    expect(
      (await app.inject({ method: 'GET', url: `/v1/campaigns/${campaign.id}`, headers: auth }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/campaigns/${campaign.id}`,
          headers: { ...json, ...auth, 'if-match': '"1"' },
          payload: { name: 'pwned' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/campaigns/${campaign.id}`,
          headers: { ...auth, 'if-match': '"1"' },
        })
      ).statusCode,
    ).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/v1/campaigns?limit=100', headers: auth });
    expect(list.json<{ data: { id: string }[] }>().data.map((item) => item.id)).not.toContain(
      campaign.id,
    );
    expect((await owner.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).name).toBe(
      'Private A',
    );
  });

  it('a token for an unknown tenant is refused', async () => {
    const token = await kit.sign({ sub: a.adminId, tnt: '01928f3a-0000-7000-8000-00000000ffff' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/campaigns',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'VERBIS_TENANT_INACTIVE' });
  });

  it('a user of tenant A presenting tenant B is refused (no such user in B)', async () => {
    const token = await kit.sign({ sub: a.adminId, tnt: b.tenantId });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/campaigns',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('pagination, filtering and sorting', () => {
  let tenant: TenantFixture;
  beforeAll(async () => {
    tenant = await createTenant(owner, kit, uniqueSlug('page'));
    for (const name of ['delta', 'alpha', 'echo', 'charlie', 'bravo', 'golf', 'foxtrot']) {
      await createCampaign(tenant, {
        name,
        status: name < 'd' ? 'active' : 'draft',
        channels: name === 'echo' ? ['chat'] : ['voice'],
      });
    }
  });

  it('walks every item exactly once with keyset cursors', async () => {
    const auth = await tenant.auth();
    const names: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/v1/campaigns?limit=3&sort=name${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page: { data: { name: string }[]; page: { nextCursor: string | null; sort: string } } =
        (await app.inject({ method: 'GET', url, headers: auth })).json();
      names.push(...page.data.map((item) => item.name));
      expect(page.page.sort).toBe('name');
      cursor = page.page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(names).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf']);
  });

  it('sorts descending by default (newest first) and filters', async () => {
    const auth = await tenant.auth();
    const latest = (
      await app.inject({ method: 'GET', url: '/v1/campaigns?limit=1', headers: auth })
    ).json<{ data: { name: string }[] }>();
    expect(latest.data[0]?.name).toBe('foxtrot');
    const active = (
      await app.inject({
        method: 'GET',
        url: '/v1/campaigns?status=active&sort=-name',
        headers: auth,
      })
    ).json<{ data: { name: string }[] }>();
    expect(active.data.map((item) => item.name)).toEqual(['charlie', 'bravo', 'alpha']);
    const chat = (
      await app.inject({ method: 'GET', url: '/v1/campaigns?channel=chat', headers: auth })
    ).json<{ data: { name: string }[] }>();
    expect(chat.data.map((item) => item.name)).toEqual(['echo']);
    const search = (
      await app.inject({ method: 'GET', url: '/v1/campaigns?q=OT', headers: auth })
    ).json<{ data: { name: string }[] }>();
    expect(search.data.map((item) => item.name)).toEqual(['foxtrot']);
  });

  it('rejects cursors reused with another sort, and unknown sort fields', async () => {
    const auth = await tenant.auth();
    const page = (
      await app.inject({ method: 'GET', url: '/v1/campaigns?limit=1&sort=name', headers: auth })
    ).json<{ page: { nextCursor: string } }>();
    const mismatch = await app.inject({
      method: 'GET',
      url: `/v1/campaigns?sort=-createdAt&cursor=${page.page.nextCursor}`,
      headers: auth,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: 'VERBIS_PAGINATION_INVALID_CURSOR' });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/campaigns?sort=tenantId', headers: auth }))
        .statusCode,
    ).toBe(400);
  });
});

describe('Idempotency-Key', () => {
  it('replays the first response for the same key and body', async () => {
    const key = { 'idempotency-key': `key-${uniqueSlug('idem')}` };
    const first = await createCampaign(a, { name: 'Idempotent' }, key);
    const second = await createCampaign(a, { name: 'Idempotent' }, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers.location).toBe(first.headers.location);
    expect(
      await owner.campaign.count({ where: { tenantId: a.tenantId, name: 'Idempotent' } }),
    ).toBe(1);
  });

  it('rejects reuse of a key with a different request', async () => {
    const key = { 'idempotency-key': `key-${uniqueSlug('idem')}` };
    await createCampaign(a, { name: 'Idem One' }, key);
    const reused = await createCampaign(a, { name: 'Idem Two' }, key);
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'VERBIS_IDEMPOTENCY_KEY_REUSED' });
  });

  it('serializes concurrent duplicates into a single effect', async () => {
    const key = { 'idempotency-key': `key-${uniqueSlug('idem')}` };
    const results = await Promise.all(
      [1, 2, 3].map(() => createCampaign(a, { name: 'Concurrent' }, key)),
    );
    expect(results.map((res) => res.statusCode)).toEqual([201, 201, 201]);
    expect(new Set(results.map((res) => res.json<{ id: string }>().id)).size).toBe(1);
    expect(
      await owner.campaign.count({ where: { tenantId: a.tenantId, name: 'Concurrent' } }),
    ).toBe(1);
  });

  it('a failed first attempt leaves the key reusable', async () => {
    const key = { 'idempotency-key': `key-${uniqueSlug('idem')}` };
    await createCampaign(a, { name: 'Clash' });
    expect((await createCampaign(a, { name: 'Clash' }, key)).statusCode).toBe(409);
    expect(await owner.idempotencyKey.count({ where: { key: key['idempotency-key'] } })).toBe(0);
  });

  it('keys are scoped per principal and validated', async () => {
    const key = { 'idempotency-key': `key-${uniqueSlug('idem')}` };
    const mine = (await createCampaign(a, { name: 'Scoped' }, key)).json<{ id: string }>();
    const theirs = await createCampaign(b, { name: 'Scoped' }, key);
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json<{ id: string }>().id).not.toBe(mine.id);
    expect(
      (await createCampaign(a, { name: 'Bad key' }, { 'idempotency-key': 'short' })).statusCode,
    ).toBe(400);
  });
});

describe('authorization', () => {
  it('enforces route permissions from the user’s roles', async () => {
    const designer = await a.auth(a.designerId);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/campaigns', headers: designer })).statusCode,
    ).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/campaigns',
      headers: { ...json, ...designer },
      payload: { name: 'Nope' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/audit-events', headers: designer })).statusCode,
    ).toBe(403);
  });

  it('refuses suspended users and suspended tenants', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/tenant', headers: await a.auth(a.inactiveId) }))
        .statusCode,
    ).toBe(403);
    const suspended = await createTenant(owner, kit, uniqueSlug('suspended'));
    await owner.tenant.update({ where: { id: suspended.tenantId }, data: { status: 'suspended' } });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tenant',
      headers: await suspended.auth(),
    });
    expect(res.json()).toMatchObject({ status: 403, code: 'VERBIS_TENANT_INACTIVE' });
  });

  it('service principals use token scopes', async () => {
    const token = await kit.sign({
      sub: 'connector-hub',
      tnt: a.tenantId,
      typ: 'service',
      scp: ['read:Campaign'],
    });
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/v1/campaigns', headers })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/v1/scripts', headers })).statusCode).toBe(403);
    const me: unknown = (await app.inject({ method: 'GET', url: '/v1/authz/me', headers })).json();
    expect(me).toEqual({
      principal: { type: 'service', id: 'connector-hub', tenantId: a.tenantId },
      permissions: ['read:Campaign'],
    });
  });
});

describe('audit trail', () => {
  it('records a gap-free, verifiable hash chain with redacted diffs, plus outbox events', async () => {
    const tenant = await createTenant(owner, kit, uniqueSlug('audit'));
    const campaign = (
      await createCampaign(tenant, { name: 'Audited', description: 'first' })
    ).json<{ id: string }>();
    await app.inject({
      method: 'PATCH',
      url: `/v1/campaigns/${campaign.id}`,
      headers: { ...json, ...(await tenant.auth()), 'if-match': '"1"' },
      payload: { description: 'second' },
    });
    await app.inject({ method: 'GET', url: '/v1/users', headers: await tenant.auth() });

    const events = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((event) => event.action)).toEqual([
      'campaign.campaign.created',
      'campaign.campaign.updated',
      'identity.user.listed',
    ]);
    expect(events.map((event) => Number(event.seq))).toEqual([1, 2, 3]);
    let prev = GENESIS_HASH;
    for (const event of events) {
      expect(event.prevHash).toBe(prev);
      expect(event.hashVersion).toBe(2);
      expect(recomputeHash(event)).toBe(event.hash);
      prev = event.hash;
    }
    expect(events[1]?.diff).toEqual({
      mode: 'snapshot',
      before: { description: 'first' },
      after: { description: 'second' },
    });
    expect(events[0]).toMatchObject({
      actorType: 'user',
      actorId: tenant.adminId,
      targetType: 'Campaign',
      targetId: campaign.id,
    });

    const outbox = await owner.outboxEvent.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    expect(outbox.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'verbis.campaigns.campaign.created.v1',
        'verbis.campaigns.campaign.updated.v1',
        'verbis.audit.event.recorded.v1',
      ]),
    );
    expect(outbox.every((event) => event.status === 'pending')).toBe(true);
  });

  it('serves the audit trail and audits that read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit-events?limit=2',
      headers: await a.auth(),
    });
    expect(res.statusCode).toBe(200);
    const page = res.json<{ data: { seq: number }[] }>();
    expect(page.data[0]!.seq).toBeGreaterThan(page.data[1]!.seq);
    const last = await owner.auditEvent.findFirst({
      where: { tenantId: a.tenantId },
      orderBy: { seq: 'desc' },
    });
    expect(last?.action).toBe('audit.event.listed');
  });

  it('rolls back state, audit and outbox together on failure', async () => {
    const before = await owner.auditEvent.count({ where: { tenantId: a.tenantId } });
    const outboxBefore = await owner.outboxEvent.count({ where: { tenantId: a.tenantId } });
    await createCampaign(a, { name: 'Atomic' });
    expect((await createCampaign(a, { name: 'Atomic' })).statusCode).toBe(409);
    // The failed attempt is audited after the rollback (its own transaction, outcome failure).
    expect(await owner.auditEvent.count({ where: { tenantId: a.tenantId } })).toBe(before + 2);
    const last = await owner.auditEvent.findFirst({
      where: { tenantId: a.tenantId },
      orderBy: { seq: 'desc' },
    });
    expect(last).toMatchObject({ action: 'api.request.failed', outcome: 'failure' });
    expect(await owner.outboxEvent.count({ where: { tenantId: a.tenantId } })).toBe(
      outboxBefore + 3,
    );
  });
});

describe('scripts and versions', () => {
  it('validates, stores, projects and serves a version', async () => {
    const auth = await a.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Credit card sales', tags: ['banking'] },
      })
    ).json<{ id: string }>();
    const created = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${script.id}/versions`,
      headers: { ...json, ...auth },
      payload: { document: surveyScript },
    });
    expect(created.statusCode).toBe(201);
    const version = created.json<{
      id: string;
      number: number;
      documentEncoding: string;
      checksum: string;
      warnings: unknown[];
      migratedFrom: string[];
    }>();
    expect(version).toMatchObject({
      number: 1,
      documentEncoding: 'json',
      warnings: [],
      migratedFrom: [],
    });
    expect(created.headers.location).toBe(`/v1/scripts/${script.id}/versions/1`);

    const screens = (
      await app.inject({
        method: 'GET',
        url: `/v1/script-versions/${version.id}/screens?limit=100`,
        headers: auth,
      })
    ).json<{ data: { id: string; key: string; entry: boolean }[] }>();
    expect(screens.data.map((screen) => screen.key)).toEqual([
      'comment',
      'intro',
      'nps',
      'reasons-high',
      'reasons-low',
      'thanks',
    ]);
    expect(screens.data.find((screen) => screen.entry)?.key).toBe('intro');
    const intro = screens.data.find((screen) => screen.key === 'intro');
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/screens/${intro?.id ?? ''}`, headers: auth })
    ).json<{ components: { key: string }[] }>();
    expect(detail.components.map((component) => component.key)).toEqual([
      'btn-intro-start',
      'intro-root',
      'intro-text',
    ]);
    expect(await owner.variable.count({ where: { scriptVersionId: version.id } })).toBe(
      surveyScript.variables?.length,
    );

    const fetched = (
      await app.inject({ method: 'GET', url: `/v1/scripts/${script.id}/versions/1`, headers: auth })
    ).json<{ document: { id: string } }>();
    expect(fetched.document.id).toBe(surveyScript.id);
  });

  it('compresses large documents and numbers versions sequentially', async () => {
    const auth = await a.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Big script' },
      })
    ).json<{ id: string }>();
    const versions = [];
    for (let i = 0; i < 2; i += 1) {
      versions.push(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/scripts/${script.id}/versions`,
            headers: { ...json, ...auth },
            payload: { document: creditCardSalesScript },
          })
        ).json<{ number: number; documentEncoding: string; documentSize: number }>(),
      );
    }
    expect(versions.map((v) => v.number)).toEqual([1, 2]);
    expect(versions[0]).toMatchObject({ documentEncoding: 'gzip' });
    expect(versions[0]!.documentSize).toBeGreaterThan(12000);
    const row = await owner.scriptVersion.findFirstOrThrow({
      where: { scriptId: script.id, number: 1 },
    });
    expect(row.document).toBeNull();
    expect(row.documentCompressed?.byteLength).toBeLessThan(row.documentSize);
    const fetched = (
      await app.inject({ method: 'GET', url: `/v1/scripts/${script.id}/versions/2`, headers: auth })
    ).json<{ document: { meta: { name: string } } }>();
    expect(fetched.document.meta.name).toBe(creditCardSalesScript.meta.name);
    const list = (
      await app.inject({ method: 'GET', url: `/v1/scripts/${script.id}/versions`, headers: auth })
    ).json<{ data: { number: number }[] }>();
    expect(list.data.map((v) => v.number)).toEqual([2, 1]);
  });

  it('rejects invalid documents with script-schema codes and migrates legacy ones', async () => {
    const auth = await a.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Validation' },
      })
    ).json<{ id: string }>();
    const cyclic = BROKEN_FIXTURES.find((fixture) => fixture.name === 'cyclic-flow');
    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${script.id}/versions`,
      headers: { ...json, ...auth },
      payload: { document: cyclic?.document },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
      errors: [{ code: 'FLOW_CYCLE', message: 'script.validation.flowCycle' }],
    });
    const legacy = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${script.id}/versions`,
      headers: { ...json, ...auth },
      payload: { document: legacyDraftScript },
    });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json()).toMatchObject({
      number: 1,
      schemaVersion: '1.1.0',
      migratedFrom: ['0.9.0→1.0.0', '1.0.0→1.1.0'],
    });
  });

  it('accepts script documents above the default 1 MiB body limit (up to 4 MiB)', async () => {
    const auth = await a.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Large' },
      })
    ).json<{ id: string }>();
    const messages = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`bulk.text${String(i)}`, 'x'.repeat(4000)]),
    );
    const document = structuredClone(surveyScript);
    document.i18n.messages['tr'] = { ...document.i18n.messages['tr'], ...messages };
    const res = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${script.id}/versions`,
      headers: { ...json, ...auth },
      payload: { document },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ documentEncoding: 'gzip' });
    expect(res.json<{ documentSize: number }>().documentSize).toBeGreaterThan(1_500_000);
  });

  it('updates script metadata with optimistic locking', async () => {
    const auth = await a.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Rename me' },
      })
    ).json<{ id: string }>();
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/scripts/${script.id}`,
      headers: { ...json, ...auth, 'if-match': '"1"' },
      payload: { name: 'Renamed', status: 'active', tags: ['x'] },
    });
    expect(renamed.json()).toMatchObject({
      name: 'Renamed',
      status: 'active',
      tags: ['x'],
      version: 2,
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/scripts/${script.id}`,
          headers: { ...json, ...auth, 'if-match': '"1"' },
          payload: { name: 'Again' },
        })
      ).statusCode,
    ).toBe(412);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/v1/scripts/01928f3a-0000-7000-8000-00000000ffff',
          headers: { ...json, ...auth, 'if-match': '"1"' },
          payload: { name: 'Ghost' },
        })
      ).statusCode,
    ).toBe(404);
    const list = (
      await app.inject({
        method: 'GET',
        url: '/v1/scripts?q=renamed&status=active&tag=x',
        headers: auth,
      })
    ).json<{ data: { id: string }[] }>();
    expect(list.data.map((item) => item.id)).toEqual([script.id]);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/scripts/${script.id}`, headers: auth })).headers
        .etag,
    ).toBe('"2"');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/scripts/${script.id}/versions/9`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/scripts/01928f3a-0000-7000-8000-00000000ffff/versions',
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('refuses versions for another tenant’s script', async () => {
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...(await a.auth()) },
        payload: { name: 'Mine' },
      })
    ).json<{ id: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${script.id}/versions`,
      headers: { ...json, ...(await b.auth()) },
      payload: { document: surveyScript },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('other modules', () => {
  it('lists users (PII, audited), roles, and secret metadata without ciphertext', async () => {
    const auth = await a.auth();
    const users = (
      await app.inject({ method: 'GET', url: '/v1/users?status=active', headers: auth })
    ).json<{ data: { email: string; roles: string[] }[] }>();
    expect(users.data.map((user) => user.roles[0]).sort()).toEqual(['designer', 'tenant_admin']);
    const roles = (
      await app.inject({ method: 'GET', url: '/v1/roles?sort=name&limit=100', headers: auth })
    ).json<{ data: { name: string }[] }>();
    expect(roles.data.map((role) => role.name)).toContain('auditor');
    await owner.secret.create({
      data: {
        tenantId: a.tenantId,
        name: 'crm-api-key',
        kind: 'api_key',
        ciphertext: new Uint8Array([1, 2, 3]),
        createdBy: 't',
        updatedBy: 't',
      },
    });
    const secrets = await app.inject({ method: 'GET', url: '/v1/secrets', headers: auth });
    expect(secrets.json<{ data: object[] }>().data[0]).toMatchObject({
      name: 'crm-api-key',
      kind: 'api_key',
    });
    expect(secrets.body).not.toContain('ciphertext');
  });

  it('lists team groups by name for scope pickers without leaking other tenants (U-05)', async () => {
    const by = { createdBy: 't', updatedBy: 't' };
    await owner.group.create({ data: { tenantId: a.tenantId, displayName: 'Ekip Kuzey', ...by } });
    await owner.group.create({
      data: { tenantId: b.tenantId, displayName: 'Foreign team', ...by },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/groups?sort=displayName&limit=100',
      headers: await a.auth(),
    });
    expect(res.statusCode).toBe(200);
    const page = res.json<{ data: { id: string; displayName: string }[] }>();
    expect(page.data.map((group) => group.displayName)).toContain('Ekip Kuzey');
    expect(res.body).not.toContain('Foreign team');
    // Names only: membership and IdP linkage are not exposed to pickers.
    expect(Object.keys(page.data[0] ?? {}).sort()).toEqual([
      'createdAt',
      'displayName',
      'id',
      'updatedAt',
      'version',
    ]);
  });

  it('creates assignments only with same-tenant references', async () => {
    const auth = await a.auth();
    const campaign = (await createCampaign(a, { name: 'Assigned' })).json<{ id: string }>();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Assigned script' },
      })
    ).json<{ id: string }>();
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/assignments',
      headers: { ...json, ...auth },
      payload: {
        scriptId: script.id,
        campaignId: campaign.id,
        rule: { fact: 'interaction.channel', op: 'eq', value: 'voice' },
      },
    });
    expect(ok.statusCode).toBe(201);
    const foreign = (await createCampaign(b, { name: 'Foreign' })).json<{ id: string }>();
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/assignments',
      headers: { ...json, ...auth },
      payload: { scriptId: script.id, campaignId: foreign.id },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ errors: { path: string }[] }>().errors.map((error) => error.path)).toEqual([
      '/body/campaignId',
    ]);
    const list = (
      await app.inject({
        method: 'GET',
        url: `/v1/assignments?campaignId=${campaign.id}`,
        headers: auth,
      })
    ).json<{ data: unknown[] }>();
    expect(list.data).toHaveLength(1);
  });

  it('serves read-only module endpoints', async () => {
    const auth = await a.auth();
    for (const url of [
      '/v1/identity-providers',
      '/v1/data-sources',
      '/v1/connectors',
      '/v1/channels',
      '/v1/sessions',
      '/v1/analytics/event-counts',
      '/v1/admin/outbox',
      '/v1/tenant',
    ]) {
      expect((await app.inject({ method: 'GET', url, headers: auth })).statusCode, url).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/sessions/01928f3a-0000-7000-8000-00000000ffff',
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/users/not-a-uuid', headers: auth })).statusCode,
    ).toBe(400);
  });

  it('reads runtime sessions and their ordered events', async () => {
    const auth = await a.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'Runtime' },
      })
    ).json<{ id: string }>();
    const version = (
      await app.inject({
        method: 'POST',
        url: `/v1/scripts/${script.id}/versions`,
        headers: { ...json, ...auth },
        payload: { document: surveyScript },
      })
    ).json<{ id: string; checksum: string }>();
    const session = await owner.session.create({
      data: {
        kind: 'preview',
        tenantId: a.tenantId,
        userId: a.adminId,
        scriptVersionId: version.id,
        state: 'active',
        checksum: version.checksum,
        createdBy: 't',
        updatedBy: 't',
      },
    });
    for (const seq of [1, 2, 3]) {
      await owner.sessionEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: a.tenantId,
          sessionId: session.id,
          seq,
          type: 'screen.entered',
          payload: { seq },
          occurredAt: new Date(),
          recordedAt: new Date(),
          createdBy: 't',
          prevHash: GENESIS_HASH,
          hash: 'a'.repeat(64),
        },
      });
    }
    expect(
      (
        await app.inject({ method: 'GET', url: `/v1/sessions/${session.id}`, headers: auth })
      ).json(),
    ).toMatchObject({ id: session.id, state: 'active' });
    const events = (
      await app.inject({
        method: 'GET',
        url: `/v1/sessions/${session.id}/events?limit=2`,
        headers: auth,
      })
    ).json<{ data: { seq: number }[]; page: { nextCursor: string } }>();
    expect(events.data.map((event) => event.seq)).toEqual([1, 2]);
    const rest = (
      await app.inject({
        method: 'GET',
        url: `/v1/sessions/${session.id}/events?cursor=${events.page.nextCursor}`,
        headers: auth,
      })
    ).json<{ data: { seq: number }[] }>();
    expect(rest.data.map((event) => event.seq)).toEqual([3]);
    const list = (
      await app.inject({
        method: 'GET',
        url: `/v1/sessions?state=active&userId=${a.adminId}`,
        headers: auth,
      })
    ).json<{ data: { id: string }[] }>();
    expect(list.data.map((item) => item.id)).toContain(session.id);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/sessions/${session.id}`,
          headers: await b.auth(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/users/${a.designerId}`, headers: auth })).json(),
    ).toMatchObject({ roles: ['designer'] });
  });

  it('rejects stale tenant settings updates', async () => {
    const auth = await a.auth();
    const etag = (await app.inject({ method: 'GET', url: '/v1/tenant', headers: auth })).headers
      .etag!;
    const stale = `"${String(Number(etag.replace(/"/g, '')) + 5)}"`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/tenant/settings',
      headers: { ...json, ...auth, 'if-match': stale },
      payload: { defaultLocale: 'en' },
    });
    expect(res.statusCode).toBe(412);
  });

  it('tenant settings drive the CORS allow-list', async () => {
    const auth = await a.auth();
    const tenant = await app.inject({ method: 'GET', url: '/v1/tenant', headers: auth });
    const etag = tenant.headers.etag!;
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/v1/campaigns',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
    expect(
      (await preflight('https://agents.acme.example')).headers['access-control-allow-origin'],
    ).toBe('https://agents.acme.example');
    expect(
      (await preflight('https://new.acme.example')).headers['access-control-allow-origin'],
    ).toBeUndefined();
    const updated = await app.inject({
      method: 'PATCH',
      url: '/v1/tenant/settings',
      headers: { ...json, ...auth, 'if-match': etag },
      payload: { allowedOrigins: ['https://agents.acme.example', 'https://new.acme.example'] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      settings: { allowedOrigins: ['https://agents.acme.example', 'https://new.acme.example'] },
    });
    const bad = await app.inject({
      method: 'PATCH',
      url: '/v1/tenant/settings',
      headers: { ...json, ...auth, 'if-match': updated.headers.etag! },
      payload: { allowedOrigins: ['http://evil.example'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await createCampaign(a, { name: 'x', description: 'y'.repeat(1_100_000) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'VERBIS_HTTP_PAYLOAD_TOO_LARGE' });
  });

  it('is ready when PostgreSQL, Redis and NATS are reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.json()).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' }, nats: { status: 'up' } },
    });
  });
});

describe('rate limiting (Redis)', () => {
  it('limits per tenant principal across app instances', async () => {
    const env = integrationEnv(kit.jwks, { RATE_LIMIT_MAX: '3' });
    const fresh = await createTenant(owner, kit, uniqueSlug('rate'));
    const [one, two] = [await startApp(env), await startApp(env)];
    try {
      const auth = await fresh.auth(fresh.designerId);
      const statuses = [];
      for (const instance of [one, two, one, two])
        statuses.push(
          (await instance.inject({ method: 'GET', url: '/v1/campaigns', headers: auth }))
            .statusCode,
        );
      expect(statuses).toEqual([200, 200, 200, 429]);
      // Another principal has its own budget.
      expect(
        (await one.inject({ method: 'GET', url: '/v1/campaigns', headers: await fresh.auth() }))
          .statusCode,
      ).toBe(200);
    } finally {
      await Promise.all([one.close(), two.close()]);
    }
  });
});
