import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SESSION_STORE } from '../../src/modules/identity/core/identity.tokens.js';
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
import type { SessionStore } from '../../src/modules/identity/session/session-store.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const SCIM_TYPE = 'application/scim+json';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

let app: NestFastifyApplication;
let owner: PrismaClient;
let kit: TokenKit;
let tenant: TenantFixture;
let slug: string;
let idpId: string;
let token: string;

const scim = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
  bearer = token,
) =>
  app.inject({
    method,
    url: `/scim/v2/${slug}${path}`,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(payload === undefined ? {} : { 'content-type': SCIM_TYPE }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

beforeAll(async () => {
  owner = ownerPrisma();
  kit = await createTokenKit();
  app = await startApp(integrationEnv(kit.jwks));
  slug = uniqueSlug('scim');
  tenant = await createTenant(owner, kit, slug);
  const idp = await app.inject({
    method: 'POST',
    url: '/v1/identity-providers',
    headers: await tenant.auth(),
    payload: {
      protocol: 'oidc',
      displayName: 'Entra',
      status: 'draft',
      scimEnabled: true,
      config: {
        vendor: 'entra',
        issuer: 'https://login.example.com/t/v2.0',
        clientId: 'c',
        roleMapping: {
          rules: [{ claim: 'groups', equals: 'CC Supervisors', roles: ['supervisor'] }],
        },
      },
    },
  });
  expect(idp.statusCode, idp.body).toBe(201);
  idpId = idp.json<{ id: string }>().id;
  // The SCIM principal requires an active IdP.
  await owner.identityProvider.update({ where: { id: idpId }, data: { status: 'active' } });
  const issued = await app.inject({
    method: 'POST',
    url: `/v1/identity-providers/${idpId}/scim-tokens`,
    headers: await tenant.auth(),
    payload: { expiresInDays: 30 },
  });
  expect(issued.statusCode, issued.body).toBe(201);
  ({ token } = issued.json<{ token: string }>());
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

describe('SCIM locale persistence', () => {
  it('persists locale-only patches, normalizes language tags and restores the default on removal', async () => {
    const created = await scim('POST', '/Users', {
      userName: 'synthetic-locale@example.invalid',
      locale: 'tr',
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const updated = await scim('PATCH', `/Users/${id}`, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'locale', value: 'en-US' }],
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<{ locale: string }>().locale).toBe('en');
    expect((await owner.user.findUniqueOrThrow({ where: { id } })).locale).toBe('en');
    const read = await scim('GET', `/Users/${id}`);
    expect(read.json<{ locale: string }>().locale).toBe('en');
    const removed = await scim('PATCH', `/Users/${id}`, {
      schemas: [PATCH],
      Operations: [{ op: 'remove', path: 'locale' }],
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json<{ locale: string }>().locale).toBe('tr');
  });
});

describe('SCIM 2.0 authentication', () => {
  it('stores only a hash and answers SCIM errors for bad tokens', async () => {
    const stored = await owner.scimToken.findFirstOrThrow({ where: { idpId } });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toContain(token);
    const bad = await scim('GET', '/Users', undefined, `vscim_${'A'.repeat(43)}`);
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['content-type']).toContain(SCIM_TYPE);
    expect(bad.json()).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
    });
    expect(
      await owner.auditEvent.findFirst({
        where: { tenantId: tenant.tenantId, action: 'identity.scimToken.rejected' },
      }),
    ).not.toBeNull();
    // A token of one tenant never works on another tenant's base URL.
    const other = await createTenant(owner, kit, uniqueSlug('scim-other'));
    const cross = await app.inject({
      method: 'GET',
      url: `/scim/v2/${(await owner.tenant.findUniqueOrThrow({ where: { id: other.tenantId } })).slug}/Users`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cross.statusCode).toBe(401);
  });

  it('serves the discovery endpoints', async () => {
    expect((await scim('GET', '/ServiceProviderConfig')).json()).toMatchObject({
      patch: { supported: true },
      filter: { supported: true },
    });
    expect(
      (await scim('GET', '/ResourceTypes')).json<{ totalResults: number }>().totalResults,
    ).toBe(2);
  });
});

describe('SCIM Users', () => {
  let userId: string;

  it('creates, filters, replaces and patches users with audit events', async () => {
    const created = await scim('POST', '/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Lin@Example.com',
      externalId: 'ext-lin',
      name: { givenName: 'Lin', familyName: 'Example' },
      emails: [{ value: 'lin@example.com', primary: true, type: 'work' }],
      active: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers.location).toMatch(new RegExp(`/scim/v2/${slug}/Users/`));
    userId = created.json<{ id: string }>().id;
    expect(created.json()).toMatchObject({
      userName: 'lin@example.com',
      displayName: 'Lin Example',
      active: true,
      externalId: 'ext-lin',
    });

    const duplicate = await scim('POST', '/Users', { userName: 'lin@example.com' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ scimType: 'uniqueness' });

    const filtered = await scim(
      'GET',
      `/Users?filter=${encodeURIComponent('userName eq "LIN@example.com"')}`,
    );
    expect(filtered.json()).toMatchObject({
      totalResults: 1,
      startIndex: 1,
      Resources: [{ id: userId }],
    });
    const byExternal = await scim(
      'GET',
      `/Users?filter=${encodeURIComponent('externalId eq "ext-lin" and active eq true')}`,
    );
    expect(byExternal.json<{ totalResults: number }>().totalResults).toBe(1);
    const invalid = await scim('GET', `/Users?filter=${encodeURIComponent('password eq "x"')}`);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ scimType: 'invalidFilter' });

    const page = await scim('GET', '/Users?startIndex=1&count=1');
    expect(page.json()).toMatchObject({ itemsPerPage: 1 });

    const replaced = await scim('PUT', `/Users/${userId}`, {
      userName: 'lin@example.com',
      displayName: 'Lin E.',
      active: true,
    });
    expect(replaced.json()).toMatchObject({ displayName: 'Lin E.' });
    const patched = await scim('PATCH', `/Users/${userId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'Replace', path: 'displayName', value: 'Lin X' }],
    });
    expect(patched.json()).toMatchObject({ displayName: 'Lin X' });
    const actions = (
      await owner.auditEvent.findMany({ where: { tenantId: tenant.tenantId, targetId: userId } })
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['identity.user.provisioned', 'identity.user.updated']),
    );
  });

  it('deactivation (active=false) suspends the user and revokes their sessions immediately', async () => {
    const sessions = app.get<SessionStore>(SESSION_STORE, { strict: false });
    await sessions.create(
      {
        tenantId: tenant.tenantId,
        userId,
        kind: 'sso',
        protocol: 'oidc',
        app: 'agent',
        ip: '127.0.0.1',
        userAgent: 'test',
      },
      {
        idleTimeoutSeconds: 600,
        absoluteTimeoutSeconds: 3600,
        maxConcurrent: 5,
        onLimit: 'evict_oldest',
      },
    );
    expect(await sessions.listForUser(tenant.tenantId, userId)).toHaveLength(1);
    const res = await scim('PATCH', `/Users/${userId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', value: { active: 'False' } }],
    });
    expect(res.json()).toMatchObject({ active: false });
    expect(await sessions.listForUser(tenant.tenantId, userId)).toHaveLength(0);
    expect(await owner.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      status: 'suspended',
    });
    const events = await owner.outboxEvent.findMany({
      where: {
        tenantId: tenant.tenantId,
        aggregateId: userId,
        eventType: 'verbis.identity.user.deactivated.v1',
      },
    });
    expect(events).toHaveLength(1);
  });

  it('DELETE deprovisions (soft delete) and the user disappears from SCIM', async () => {
    const del = await scim('DELETE', `/Users/${userId}`);
    expect(del.statusCode).toBe(204);
    expect((await scim('GET', `/Users/${userId}`)).statusCode).toBe(404);
    expect(await owner.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      status: 'deprovisioned',
    });
  });
});

describe('SCIM Groups and role mapping', () => {
  it('group membership grants mapped roles (source scim:<idp>) and removal revokes them', async () => {
    const user = await scim('POST', '/Users', { userName: 'sup@example.com', active: true });
    const userId = user.json<{ id: string }>().id;
    const group = await scim('POST', '/Groups', {
      displayName: 'CC Supervisors',
      members: [{ value: userId }],
    });
    expect(group.statusCode, group.body).toBe(201);
    const groupId = group.json<{ id: string }>().id;
    const roles = async () =>
      (
        await owner.userRole.findMany({
          where: { userId, deletedAt: null },
          include: { role: true },
        })
      ).map((r) => `${r.role.name}/${r.source}`);
    expect(await roles()).toEqual([`supervisor/scim:${idpId}`]);

    const byMember = await scim(
      'GET',
      `/Groups?filter=${encodeURIComponent(`members.value eq "${userId}"`)}`,
    );
    expect(byMember.json<{ totalResults: number }>().totalResults).toBe(1);
    const lean = await scim('GET', '/Groups?excludedAttributes=members');
    expect(lean.json<{ Resources: Record<string, unknown>[] }>().Resources[0]).not.toHaveProperty(
      'members',
    );

    const removed = await scim('PATCH', `/Groups/${groupId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'remove', path: `members[value eq "${userId}"]` }],
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await roles()).toEqual([]);

    await scim('PATCH', `/Groups/${groupId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'add', path: 'members', value: [{ value: userId }] }],
    });
    expect(await roles()).toEqual([`supervisor/scim:${idpId}`]);
    const renamed = await scim('PATCH', `/Groups/${groupId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Other' }],
    });
    expect(renamed.json()).toMatchObject({ displayName: 'Other' });
    expect(await roles()).toEqual([]);

    expect((await scim('DELETE', `/Groups/${groupId}`)).statusCode).toBe(204);
    const audit = (
      await owner.auditEvent.findMany({ where: { tenantId: tenant.tenantId, targetId: groupId } })
    ).map((e) => e.action);
    expect(audit).toEqual(
      expect.arrayContaining([
        'identity.group.created',
        'identity.group.membersChanged',
        'identity.group.updated',
        'identity.group.deleted',
      ]),
    );
    const roleAudit = await owner.auditEvent.findMany({
      where: {
        tenantId: tenant.tenantId,
        targetId: userId,
        action: { in: ['identity.userRole.granted', 'identity.userRole.revoked'] },
      },
    });
    expect(roleAudit.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects unknown members and revoked tokens', async () => {
    const bad = await scim('POST', '/Groups', {
      displayName: 'Bad',
      members: [{ value: '00000000-0000-7000-8000-000000000000' }],
    });
    expect(bad.statusCode).toBe(400);
    const list = await app.inject({
      method: 'GET',
      url: `/v1/identity-providers/${idpId}/scim-tokens`,
      headers: await tenant.auth(),
    });
    const tokenId = list.json<{ id: string }[]>()[0]?.id ?? '';
    expect(list.body).not.toContain(token);
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/v1/identity-providers/${idpId}/scim-tokens/${tokenId}`,
      headers: await tenant.auth(),
    });
    expect(revoke.statusCode).toBe(204);
    expect((await scim('GET', '/Users')).statusCode).toBe(401);
  });
});

describe('SCIM filter and update boundary regressions', () => {
  beforeAll(async () => {
    const issued = await app.inject({
      method: 'POST',
      url: `/v1/identity-providers/${idpId}/scim-tokens`,
      headers: await tenant.auth(),
      payload: { expiresInDays: 30 },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    token = issued.json<{ token: string }>().token;
  });
  it.each([
    'id eq "not-a-uuid"',
    'emails.type eq "work"',
    'emails.primary eq true',
    'active ne false',
    'active eq false',
    'name.formatted co "Synthetic"',
    'meta.created gt "2020-01-01T00:00:00Z"',
    'groups.value eq "01928f3a-0000-7000-8000-0000000000ff"',
    ' ',
  ])('accepts supported User filters without a server error: %s', async (filter) => {
    const response = await scim('GET', `/Users?filter=${encodeURIComponent(filter)}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    });
    if (filter.startsWith('id eq'))
      expect(response.json<{ totalResults: number }>().totalResults).toBe(0);
  });
  it.each([
    'id ne "01928f3a-0000-7000-8000-0000000000ff"',
    'emails.type eq "home"',
    'emails.primary eq false',
    'active eq "yes"',
    'active pr',
    'groups.value eq "invalid"',
  ])('rejects unsupported User filter semantics: %s', async (filter) => {
    const response = await scim('GET', `/Users?filter=${encodeURIComponent(filter)}`);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ scimType: 'invalidFilter' });
  });
  it.each(['not-a-uuid', '01928f3a-0000-7000-8000-0000000000fe'])(
    'answers SCIM 404 for missing resources: %s',
    async (id) => {
      for (const resource of ['Users', 'Groups']) {
        const response = await scim('GET', `/${resource}/${id}`);
        expect(response.statusCode, response.body).toBe(404);
        expect(response.headers['content-type']).toContain(SCIM_TYPE);
      }
    },
  );
  it('rejects malformed email patches at the HTTP boundary and preserves the saved user', async () => {
    const created = await scim('POST', '/Users', {
      userName: 'synthetic-email-patch@example.invalid',
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    for (const value of [[null], ['invalid'], [[]]]) {
      const response = await scim('PATCH', `/Users/${id}`, {
        schemas: [PATCH],
        Operations: [{ op: 'replace', path: 'emails', value }],
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({ scimType: 'invalidValue' });
    }
    expect((await owner.user.findUniqueOrThrow({ where: { id } })).email).toBe(
      'synthetic-email-patch@example.invalid',
    );
  });
  it('does not increment the user version for an identical patch and reports conflicting renamed users', async () => {
    const created = await scim('POST', '/Users', {
      userName: 'synthetic-identical@example.invalid',
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const before = await owner.user.findUniqueOrThrow({ where: { id } });
    const unchanged = await scim('PATCH', `/Users/${id}`, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'userName', value: before.email }],
    });
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    expect((await owner.user.findUniqueOrThrow({ where: { id } })).version).toBe(before.version);
    const duplicate = await scim('PATCH', `/Users/${id}`, {
      schemas: [PATCH],
      Operations: [
        { op: 'replace', path: 'userName', value: 'synthetic-email-patch@example.invalid' },
      ],
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({ scimType: 'uniqueness' });
  });
  it('supports member filters, excludes member details, and detects duplicate groups', async () => {
    const created = await scim('POST', '/Groups', { displayName: 'Synthetic filter group' });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const duplicate = await scim('POST', '/Groups', { displayName: 'Synthetic filter group' });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    const response = await scim(
      'GET',
      `/Groups?filter=${encodeURIComponent(`id eq "${id}"`)}&excludedAttributes=members`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ Resources: Record<string, unknown>[] }>().Resources[0],
    ).not.toHaveProperty('members');
    for (const filter of [
      `members.value eq "${tenant.adminId}"`,
      'meta.lastModified gt "2020-01-01T00:00:00Z"',
      'id eq "invalid"',
    ])
      expect((await scim('GET', `/Groups?filter=${encodeURIComponent(filter)}`)).statusCode).toBe(
        200,
      );
    expect(
      (await scim('GET', `/Groups?filter=${encodeURIComponent('members.value eq "invalid"')}`))
        .statusCode,
    ).toBe(400);
  });
});

describe('SCIM Bulk', () => {
  const request = (Operations: unknown[], failOnErrors?: number) =>
    scim('POST', '/Bulk', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
      Operations,
      ...(failOnErrors === undefined ? {} : { failOnErrors }),
    });
  it('resolves forward references, preserves successful operations and audits failures independently', async () => {
    const email = `${uniqueSlug('bulk-user')}@example.com`;
    const before = await owner.auditEvent.count({ where: { tenantId: tenant.tenantId } });
    const response = await request([
      {
        method: 'POST',
        path: '/Groups',
        bulkId: 'g',
        data: { displayName: 'Bulk team', members: [{ value: 'bulkId:u' }] },
      },
      {
        method: 'POST',
        path: '/Users',
        bulkId: 'u',
        data: { userName: email, displayName: 'bulkId:literal' },
      },
      { method: 'POST', path: '/Users', bulkId: 'bad', data: { userName: 'invalid' } },
      {
        method: 'PATCH',
        path: '/Users/bulkId:u',
        data: {
          schemas: [PATCH],
          Operations: [{ op: 'replace', path: 'displayName', value: 'Updated' }],
        },
      },
    ]);
    expect(response.statusCode, response.body).toBe(200);
    const results = response.json<{ Operations: { status: string; location?: string }[] }>()
      .Operations;
    expect(results.map((x) => x.status)).toEqual(['201', '201', '400', '200']);
    const userId = results[1]!.location!.split('/').at(-1)!;
    expect((await scim('GET', `/Users/${userId}`)).json()).toMatchObject({
      displayName: 'Updated',
    });
    const groupId = results[0]!.location!.split('/').at(-1)!;
    expect((await scim('GET', `/Groups/${groupId}`)).json()).toMatchObject({
      members: [{ value: userId }],
    });
    expect(
      await owner.auditEvent.count({ where: { tenantId: tenant.tenantId } }),
    ).toBeGreaterThanOrEqual(before + 4);
  });
  it('stops at failOnErrors and rejects duplicate ids and oversized operation lists', async () => {
    const response = await request(
      [
        { method: 'POST', path: '/Users', bulkId: 'bad', data: { userName: 'invalid' } },
        {
          method: 'POST',
          path: '/Users',
          bulkId: 'later',
          data: { userName: `${uniqueSlug('not-created')}@example.com` },
        },
      ],
      1,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ Operations: unknown[] }>().Operations).toHaveLength(1);
    expect(
      (
        await request([
          { method: 'POST', path: '/Users', bulkId: 'same', data: {} },
          { method: 'POST', path: '/Users', bulkId: 'same', data: {} },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          Array.from({ length: 101 }, (_, i) => ({
            method: 'POST',
            path: '/Users',
            bulkId: `u${i}`,
            data: {},
          })),
        )
      ).statusCode,
    ).toBe(413);
  });
  it('rejects URL traversal, unknown references and foreign tenant resource ids without side effects', async () => {
    const other = await createTenant(owner, kit, uniqueSlug('bulk-other'));
    const original = await owner.user.findUniqueOrThrow({ where: { id: other.adminId } });
    const response = await request([
      { method: 'DELETE', path: `/Users/${other.adminId}` },
      { method: 'DELETE', path: '/Users/../../Groups' },
      { method: 'DELETE', path: '/Users/bulkId:missing' },
    ]);
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ Operations: { status: string }[] }>().Operations.map((x) => x.status),
    ).toEqual(['404', '400', '400']);
    expect(await owner.user.findUnique({ where: { id: other.adminId } })).toEqual(original);
  });
  it('returns a conflict for an unresolvable reference cycle without provisioning resources', async () => {
    const response = await request([
      {
        method: 'POST',
        path: '/Groups',
        bulkId: 'one',
        data: { displayName: 'Cycle one', members: [{ value: 'bulkId:two' }] },
      },
      {
        method: 'POST',
        path: '/Groups',
        bulkId: 'two',
        data: { displayName: 'Cycle two', members: [{ value: 'bulkId:one' }] },
      },
    ]);
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ Operations: { status: string }[] }>().Operations.map((x) => x.status),
    ).toEqual(['409', '409']);
  });
});
