/* Vitest asymmetric matchers describe the problem JSON returned by real HTTP requests. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { generateKeyPairSync } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { PackageKeys, buildPackage } from '../../src/modules/scripts/domain/package-format.js';
import { documentChecksum } from '../../src/modules/scripts/packages.service.js';
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

let owner: PrismaClient, app: NestFastifyApplication, tenant: TenantFixture, kit: TokenKit;
const pair = generateKeyPairSync('ed25519');
const signing = JSON.stringify({
  ...pair.privateKey.export({ format: 'jwk' }),
  kid: 'synthetic-gate',
});
const keys = PackageKeys.from(signing, undefined);
beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  tenant = await createTenant(owner, kit, uniqueSlug('release-gate'));
  app = await startApp(
    integrationEnv(kit.jwks, { PACKAGE_SIGNING_JWK: signing, VERBIS_ENVIRONMENT: 'test' }),
  );
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

const call = async (url: string, payload: object, target = tenant, designer = false) =>
  app.inject({
    method: 'POST',
    url,
    payload,
    headers: {
      'content-type': 'application/json',
      ...(await target.auth(designer ? target.designerId : target.adminId)),
    },
  });
const scenario = {
  id: 'end',
  name: 'Synthetic end',
  synthetic: true as const,
  context: {},
  steps: [{ type: 'event' as const, node: 'btn-next', event: 'onPress' }],
  expected: { ended: true },
};
async function draft(document = minimalScript()) {
  const script = await call('/v1/scripts', { name: uniqueSlug('script') });
  expect(script.statusCode).toBe(201);
  const id = script.json<{ id: string }>().id;
  const version = await call(`/v1/scripts/${id}/versions`, { document });
  expect(version.statusCode, version.body).toBe(201);
  return { id, versionId: version.json<{ id: string }>().id, path: `/v1/scripts/${id}/versions/1` };
}

it.each(['empty', 'component', 'missing source', 'stale source', 'unpromoted source'] as const)(
  'blocks submit for %s and leaves the draft unchanged',
  async (reason) => {
    const document = minimalScript();
    document.testScenarios = reason === 'empty' ? [] : [scenario];
    if (reason === 'component')
      document.pages[0]!.layout.children!.push({
        id: 'invalid',
        type: 'text',
        props: { contentKey: 'common.next' },
      });
    if (reason.endsWith('source')) {
      document.dataSources = [{ id: 'lookup', ref: 'tenant-datasource:customer', version: 2 }];
      if (reason !== 'missing source')
        await owner.dataSource.create({
          data: {
            tenantId: tenant.tenantId,
            key: 'customer',
            protocol: 'rest',
            version: reason === 'stale source' ? 3 : 2,
            definition: {
              baseUrl: 'https://example.test',
              endpoint: '/lookup',
              auth: { type: 'none' },
              profiles: {},
            },
            secretRefs: [],
            createdBy: 'test',
            updatedBy: 'test',
          },
        });
    }
    try {
      const f = await draft(document);
      const response = await call(`${f.path}/submit`, { semver: '1.0.0', changeNote: 'Synthetic' });
      expect(response.statusCode, response.body).toBe(reason === 'empty' ? 400 : 422);
      expect(response.json()).toMatchObject({
        code: reason === 'empty' ? 'VERBIS_VALIDATION_FAILED' : 'VERBIS_SCRIPT_DOCUMENT_INVALID',
        correlationId: expect.any(String),
        errors: expect.any(Array),
      });
      const sourceMessages = {
        'missing source': 'data source is missing in this tenant',
        'stale source': 'data source version does not match the pinned version',
        'unpromoted source': 'an approved production profile is required',
      };
      if (reason in sourceMessages)
        expect(response.json<{ errors: { message: string }[] }>().errors[0]?.message).toBe(
          sourceMessages[reason as keyof typeof sourceMessages],
        );
      expect(await owner.scriptVersion.findUnique({ where: { id: f.versionId } })).toMatchObject({
        state: 'draft',
        submittedAt: null,
      });
      expect(
        await owner.outboxEvent.count({
          where: {
            tenantId: tenant.tenantId,
            aggregateId: f.versionId,
            eventType: 'verbis.scripts.version.submitted.v1',
          },
        }),
      ).toBe(0);
    } finally {
      // Sources are soft-deleted: their immutable version history is append-only (ADR-0042).
      await owner.dataSource.updateMany({
        where: { tenantId: tenant.tenantId, key: 'customer', deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
  },
);

it('submits, approves and publishes an exact approved production pin with passing saved scenarios', async () => {
  await owner.dataSource.create({
    data: {
      tenantId: tenant.tenantId,
      key: 'approved-customer',
      protocol: 'rest',
      version: 2,
      definition: {
        baseUrl: 'https://example.test',
        endpoint: '/lookup',
        auth: { type: 'none' },
        profiles: { prod: { baseUrl: 'https://prod.example.test', auth: { type: 'none' } } },
      },
      secretRefs: [],
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  const doc = minimalScript();
  doc.testScenarios = [scenario];
  doc.dataSources = [{ id: 'lookup', ref: 'tenant-datasource:approved-customer', version: 2 }];
  const f = await draft(doc);
  expect(
    (await call(`${f.path}/submit`, { semver: '1.0.0', changeNote: 'Synthetic' })).statusCode,
  ).toBe(200);
  expect((await call(`${f.path}/reviews`, { decision: 'approved' }, tenant, true)).statusCode).toBe(
    200,
  );
  const published = await call(`${f.path}/publish`, {}, tenant, true);
  expect(published.statusCode, published.body).toBe(200);
  expect((await owner.script.findUnique({ where: { id: f.id } }))?.currentVersionId).toBe(
    f.versionId,
  );
});

it('rechecks dependencies at publish even if an approved draft bypassed today’s submit gate', async () => {
  const doc = minimalScript();
  doc.testScenarios = [scenario];
  doc.dataSources = [{ id: 'lookup', ref: 'tenant-datasource:gone', version: 1 }];
  const f = await draft(doc);
  await owner.scriptVersion.update({
    where: { id: f.versionId },
    data: { state: 'approved', semver: '1.0.0' },
  });
  const response = await call(`${f.path}/publish`, {}, tenant, true);
  expect(response.statusCode, response.body).toBe(422);
  expect((await owner.scriptVersion.findUnique({ where: { id: f.versionId } }))?.state).toBe(
    'approved',
  );
});

it.each(['empty', 'component'] as const)(
  'rechecks %s documents at publish for historical approvals',
  async (reason) => {
    const doc = minimalScript();
    doc.testScenarios = reason === 'empty' ? [] : [scenario];
    if (reason === 'component')
      doc.pages[0]!.layout.children!.push({
        id: 'invalid',
        type: 'text',
        props: { contentKey: 'common.next' },
      });
    const f = await draft(doc);
    await owner.scriptVersion.update({
      where: { id: f.versionId },
      data: { state: 'approved', semver: '1.0.0' },
    });
    const response = await call(`${f.path}/publish`, {}, tenant, true);
    expect(response.statusCode, response.body).toBe(reason === 'empty' ? 400 : 422);
    expect((await owner.script.findUnique({ where: { id: f.id } }))?.currentVersionId).toBeNull();
  },
);

it.each(['empty', 'component', 'missing source', 'stale source'] as const)(
  'rejects trusted signed %s imports without creating scripts or release records',
  async (reason) => {
    const doc = minimalScript();
    doc.testScenarios = reason === 'empty' ? [] : [scenario];
    if (reason === 'component')
      doc.pages[0]!.layout.children!.push({
        id: 'invalid',
        type: 'text',
        props: { contentKey: 'common.next' },
      });
    if (reason.endsWith('source'))
      doc.dataSources = [{ id: 'lookup', ref: 'tenant-datasource:import-customer', version: 1 }];
    if (reason === 'stale source')
      await owner.dataSource.create({
        data: {
          tenantId: tenant.tenantId,
          key: 'import-customer',
          protocol: 'rest',
          version: 2,
          definition: {},
          secretRefs: [],
          createdBy: 'test',
          updatedBy: 'test',
        },
      });
    const document = ScriptDocumentSchema.parse(doc),
      name = uniqueSlug('invalid-import');
    const pkg = buildPackage(
      {
        packageId: uniqueSlug('pkg'),
        createdAt: new Date().toISOString(),
        createdBy: 'test',
        sourceEnvironment: 'dev',
        targetEnvironments: ['test'],
      },
      {
        scripts: [
          {
            name,
            description: null,
            tags: [],
            semver: '1.0.0',
            changeNote: 'Synthetic',
            document,
            checksum: documentChecksum(document),
            sharedScreens: [],
          },
        ],
        sharedScreens: [],
      },
      keys,
    );
    const response = await call('/v1/script-packages/import', pkg);
    expect(response.statusCode, response.body).toBe(reason === 'empty' ? 400 : 422);
    expect(response.json()).toMatchObject({
      code:
        reason === 'empty'
          ? 'VERBIS_VALIDATION_FAILED'
          : reason === 'component'
            ? 'VERBIS_SCRIPT_DOCUMENT_INVALID'
            : 'VERBIS_PACKAGE_INVALID',
      correlationId: expect.any(String),
    });
    expect(await owner.script.count({ where: { tenantId: tenant.tenantId, name } })).toBe(0);
  },
);

it('creates and binds atomically inside the scoped designer’s campaign and explains absent scope', async () => {
  const scoped = await createTenant(owner, kit, uniqueSlug('scoped-create'));
  const campaign = await owner.campaign.create({
    data: {
      tenantId: scoped.tenantId,
      name: 'Synthetic campaign',
      code: 'SYNTHETIC',
      channels: ['voice'],
      locales: ['tr'],
      queues: [],
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  const role = await owner.role.findFirstOrThrow({
    where: { tenantId: scoped.tenantId, name: 'script_designer' },
  });
  await owner.userRole.deleteMany({
    where: { tenantId: scoped.tenantId, userId: scoped.designerId },
  });
  await owner.userRole.create({
    data: {
      tenantId: scoped.tenantId,
      userId: scoped.designerId,
      roleId: role.id,
      scope: { campaignIds: [campaign.id] },
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  const denied = await call('/v1/scripts', { name: 'Unbound' }, scoped, true);
  expect(denied.statusCode).toBe(403);
  expect(denied.json()).toMatchObject({ code: 'VERBIS_AUTHZ_SCOPE_MISSING' });
  expect(await owner.script.count({ where: { tenantId: scoped.tenantId } })).toBe(0);
  const created = await call(
    '/v1/scripts',
    { name: 'Bound', campaignId: campaign.id },
    scoped,
    true,
  );
  expect(created.statusCode, created.body).toBe(201);
  const scriptId = created.json<{ id: string }>().id;
  const headers = await scoped.auth(scoped.designerId);
  const versions = await app.inject({
    method: 'GET',
    url: `/v1/scripts/${scriptId}/versions`,
    headers,
  });
  expect(versions.statusCode, versions.body).toBe(200);
  expect(versions.json<{ data: unknown[] }>().data).toEqual([]);
  expect(
    await owner.assignment.findMany({ where: { tenantId: scoped.tenantId, scriptId } }),
  ).toHaveLength(1);
  const version = await call(
    `/v1/scripts/${scriptId}/versions`,
    { document: { ...minimalScript(), testScenarios: [scenario] } },
    scoped,
    true,
  );
  expect(version.statusCode, version.body).toBe(201);
  const readable = await app.inject({
    method: 'GET',
    url: `/v1/scripts/${scriptId}/versions/1`,
    headers,
  });
  expect(readable.statusCode, readable.body).toBe(200);
  expect(
    (
      await call(
        `/v1/scripts/${scriptId}/versions/1/submit`,
        { semver: '1.0.0', changeNote: 'Synthetic' },
        scoped,
        true,
      )
    ).statusCode,
  ).toBe(200);
  const foreign = await call(
    '/v1/scripts',
    { name: 'Foreign', campaignId: campaign.id },
    tenant,
    true,
  );
  expect(foreign.statusCode).toBe(404);
  expect(await owner.script.count({ where: { tenantId: tenant.tenantId, name: 'Foreign' } })).toBe(
    0,
  );
});
