import { generateKeyPairSync } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initializeDocument, Y } from '@verbis/collaboration';
import { ScriptDocumentSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript, surveyScript } from '@verbis/script-schema/fixtures';

import { requestContext } from '../../src/common/context/request-context.js';
import { ResolverCacheInvalidator } from '../../src/modules/routing/resolver-cache.invalidator.js';
import { CollaborationService } from '../../src/modules/scripts/collaboration.service.js';
import { DraftLeaseService } from '../../src/modules/scripts/draft-lease.service.js';
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
import type { Document } from '@hocuspocus/server';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Parsed .verbis package; fields are mutated by path in the tamper test. */
interface PackageJson {
  payload: { scripts: { document: { meta: { name: string } } }[] };
  [key: string]: unknown;
}

let kit: TokenKit;
let owner: PrismaClient;
let app: NestFastifyApplication;
let t: TenantFixture;
const json = { 'content-type': 'application/json' };

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signingJwk = JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'it-dev' });

beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  t = await createTenant(owner, kit, uniqueSlug('authoring'));
  await owner.dataSource.create({
    data: {
      tenantId: t.tenantId,
      key: 'survey-submit',
      protocol: 'rest',
      version: 1,
      definition: {
        baseUrl: 'https://example.test',
        endpoint: '/survey',
        auth: { type: 'none' },
        profiles: { prod: { baseUrl: 'https://example.test', auth: { type: 'none' } } },
      },
      secretRefs: [],
      createdBy: 'fixture-approved',
      updatedBy: 'fixture-approved',
    },
  });
  app = await startApp(
    integrationEnv(kit.jwks, {
      PACKAGE_SIGNING_JWK: signingJwk,
      PACKAGE_TRUSTED_JWKS: JSON.stringify({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'it-dev' }],
      }),
      VERBIS_ENVIRONMENT: 'dev',
    }),
  );
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

type Who = 'admin' | 'designer';
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  who: Who = 'admin',
  extra: Record<string, string> = {},
  tenant = t,
) {
  const auth = await tenant.auth(who === 'admin' ? tenant.adminId : tenant.designerId);
  return app.inject({
    method,
    url,
    headers: { ...json, ...auth, ...extra },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function newScript(name: string, tenant = t): Promise<{ id: string }> {
  const res = await call('POST', '/v1/scripts', { name }, 'admin', {}, tenant);
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function newVersion(
  scriptId: string,
  document: unknown = surveyScript,
  screens: unknown[] = [],
  tenant = t,
) {
  const res = await call(
    'POST',
    `/v1/scripts/${scriptId}/versions`,
    { document: releaseFixture(document), screens },
    'admin',
    {},
    tenant,
  );
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string; number: number; checksum: string; version: number }>();
}

function releaseFixture(input: unknown) {
  const document = ScriptDocumentSchema.parse(input);
  if (document.testScenarios !== undefined) return document;
  document.testScenarios = [
    TestScenarioSchema.parse(
      document.pages[0]?.id === 'intro'
        ? {
            id: 'surveyEnd',
            name: 'Synthetic promoter survey',
            synthetic: true,
            context: {},
            dataSources: {
              submitSurvey: { kind: 'success', outputs: { responseId: 'synthetic-id' } },
            },
            steps: [
              { type: 'event', node: 'btn-intro-start', event: 'onPress' },
              { type: 'variable', variable: 'npsScore', value: 10 },
              { type: 'event', node: 'btn-nps-next', event: 'onPress' },
              { type: 'variable', variable: 'reasons', value: ['speed'] },
              { type: 'event', node: 'btn-reasons-high-next', event: 'onPress' },
              { type: 'event', node: 'btn-submit', event: 'onPress' },
              { type: 'event', node: 'btn-thanks', event: 'onPress' },
            ],
            expected: { ended: true, variables: { npsSegment: 'promoter' } },
          }
        : {
            id: 'minimalEnd',
            name: 'Synthetic end',
            synthetic: true,
            context: {},
            steps: [{ type: 'event', node: 'btn-next', event: 'onPress' }],
            expected: { ended: true },
          },
    ),
  ];
  return document;
}

/** admin authors, designer (a different person) approves and publishes — SoD satisfied. */
async function publish(scriptId: string, number: number, semver: string) {
  expect(
    (
      await call('POST', `/v1/scripts/${scriptId}/versions/${String(number)}/submit`, {
        semver,
        changeNote: 'release',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await call(
        'POST',
        `/v1/scripts/${scriptId}/versions/${String(number)}/reviews`,
        { decision: 'approved' },
        'designer',
      )
    ).json(),
  ).toMatchObject({ state: 'approved' });
  const res = await call(
    'POST',
    `/v1/scripts/${scriptId}/versions/${String(number)}/publish`,
    {},
    'designer',
  );
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string; state: string }>();
}

describe('script version lifecycle', () => {
  it('allows only one of two API instances to save the same draft revision without losing the winner', async () => {
    const script = await newScript('Concurrent draft');
    const version = await newVersion(script.id);
    const peer = await startApp(integrationEnv(kit.jwks));
    try {
      const documents = [structuredClone(surveyScript), structuredClone(surveyScript)];
      documents[0]!.meta.name = 'Synthetic first writer';
      documents[1]!.meta.name = 'Synthetic second writer';
      const headers = {
        ...json,
        ...(await t.auth()),
        'if-match': `"${String(version.version)}"`,
      };
      const results = await Promise.all(
        [app, peer].map((instance, index) =>
          instance.inject({
            method: 'PUT',
            url: `/v1/scripts/${script.id}/versions/1/document`,
            headers,
            payload: { document: documents[index] },
          }),
        ),
      );
      expect(results.map((result) => result.statusCode).sort()).toEqual([200, 412]);
      const winner = results.findIndex((result) => result.statusCode === 200);
      const saved = (await call('GET', `/v1/scripts/${script.id}/versions/1`)).json<{
        document: typeof surveyScript;
        version: number;
      }>();
      expect(saved.document.meta.name).toBe(documents[winner]!.meta.name);
      expect(saved.version).toBe(version.version + 1);
      expect(
        await owner.auditEvent.count({
          where: { tenantId: t.tenantId, targetId: version.id, action: 'script.version.updated' },
        }),
      ).toBe(1);
      const denied = results.find((result) => result.statusCode === 412);
      expect(denied?.json()).toMatchObject({ code: 'VERBIS_CONCURRENCY_VERSION_MISMATCH' });
    } finally {
      await peer.close();
    }
  });
  it('draft → in_review → approved → published, with SoD, immutability and audit', async () => {
    const script = await newScript('Lifecycle');
    const v1 = await newVersion(script.id);
    const submit = await call('POST', `/v1/scripts/${script.id}/versions/1/submit`, {
      semver: '1.0.0',
      changeNote: 'first release',
    });
    expect(submit.json()).toMatchObject({
      state: 'in_review',
      semver: '1.0.0',
      changeNote: 'first release',
      reviewRound: 1,
    });

    // The author cannot approve their own version.
    const self = await call('POST', `/v1/scripts/${script.id}/versions/1/reviews`, {
      decision: 'approved',
    });
    expect(self.statusCode).toBe(403);
    expect(self.json<{ code: string }>().code).toBe('VERBIS_AUTHZ_SOD_VIOLATION');
    // Publishing before approval is an invalid transition.
    expect(
      (await call('POST', `/v1/scripts/${script.id}/versions/1/publish`, {}, 'designer')).json<{
        code: string;
      }>().code,
    ).toBe('VERBIS_SCRIPT_INVALID_TRANSITION');

    const comment = await call(
      'POST',
      `/v1/scripts/${script.id}/versions/1/reviews`,
      { decision: 'commented', comment: 'looks good' },
      'designer',
    );
    expect(comment.json()).toMatchObject({ state: 'in_review' });
    expect(
      (
        await call(
          'POST',
          `/v1/scripts/${script.id}/versions/1/reviews`,
          { decision: 'approved' },
          'designer',
        )
      ).json(),
    ).toMatchObject({ state: 'approved' });
    expect(
      (await owner.scriptVersion.findFirstOrThrow({ where: { scriptId: script.id, number: 1 } }))
        .updatedBy,
    ).toBe(`user:${t.adminId}`);
    // The author cannot publish either (SoD covers publish).
    expect(
      (await call('POST', `/v1/scripts/${script.id}/versions/1/publish`, {})).json<{
        code: string;
      }>().code,
    ).toBe('VERBIS_AUTHZ_SOD_VIOLATION');
    expect(
      (await call('POST', `/v1/scripts/${script.id}/versions/1/publish`, {}, 'designer')).json(),
    ).toMatchObject({ state: 'published' });
    expect((await call('GET', `/v1/scripts/${script.id}`)).json()).toMatchObject({
      currentVersionId: v1.id,
      status: 'active',
    });

    // Published content is immutable — API and database.
    const edit = await call(
      'PUT',
      `/v1/scripts/${script.id}/versions/1/document`,
      { document: surveyScript },
      'admin',
      { 'if-match': `"${String(v1.version + 3)}"` },
    );
    expect(edit.json<{ code: string }>().code).toBe('VERBIS_SCRIPT_VERSION_IMMUTABLE');
    await expect(
      owner.$executeRawUnsafe(`UPDATE script_versions SET checksum = 'x' WHERE id = '${v1.id}'`),
    ).rejects.toThrow(/immutable/);
    await expect(
      owner.$executeRawUnsafe(`UPDATE script_versions SET state = 'draft' WHERE id = '${v1.id}'`),
    ).rejects.toThrow(/only be retired/);
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM script_versions WHERE id = '${v1.id}'`),
    ).rejects.toThrow(/append-only/);

    const reviews = (await call('GET', `/v1/scripts/${script.id}/versions/1/reviews`)).json<
      { decision: string }[]
    >();
    expect(reviews.map((r) => r.decision)).toEqual(['commented', 'approved']);
    const actions = (
      await owner.auditEvent.findMany({
        where: { tenantId: t.tenantId, targetId: v1.id },
        orderBy: { seq: 'asc' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'script.version.created',
        'script.version.submitted',
        'script.version.reviewed',
        'script.version.approved',
        'script.version.published',
      ]),
    );
    const outbox = await owner.outboxEvent.findMany({
      where: { tenantId: t.tenantId, aggregateId: v1.id },
    });
    expect(outbox.map((o) => o.eventType)).toContain('verbis.scripts.version.published.v1');
  });

  it('semver must increase; rejection needs a reason and returns to draft; drafts are editable', async () => {
    const script = await newScript('Semver');
    await newVersion(script.id);
    await publish(script.id, 1, '1.0.0');
    const v2 = await newVersion(script.id);
    expect(
      (
        await call('POST', `/v1/scripts/${script.id}/versions/2/submit`, {
          semver: '1.0.0',
          changeNote: 'x',
        })
      ).json<{ code: string }>().code,
    ).toBe('VERBIS_SCRIPT_SEMVER_NOT_INCREASING');
    expect(
      (
        await call('POST', `/v1/scripts/${script.id}/versions/2/submit`, {
          semver: '0.9.0',
          changeNote: 'x',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call('POST', `/v1/scripts/${script.id}/versions/2/submit`, {
          semver: '1.1.0',
          changeNote: 'offer',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          'POST',
          `/v1/scripts/${script.id}/versions/2/reviews`,
          { decision: 'rejected' },
          'designer',
        )
      ).statusCode,
    ).toBe(400);
    const rejected = await call(
      'POST',
      `/v1/scripts/${script.id}/versions/2/reviews`,
      { decision: 'rejected', reason: 'missing disclosure' },
      'designer',
    );
    expect(rejected.json()).toMatchObject({ state: 'draft' });
    const audit = await owner.auditEvent.findFirst({
      where: { tenantId: t.tenantId, targetId: v2.id, action: 'script.version.rejected' },
    });
    expect(audit?.reason).toBe('missing disclosure');

    const current = (await call('GET', `/v1/scripts/${script.id}/versions/2`)).json<{
      version: number;
    }>();
    const changed = releaseFixture({
      ...surveyScript,
      meta: { ...surveyScript.meta, description: 'changed' },
    });
    const edit = await call(
      'PUT',
      `/v1/scripts/${script.id}/versions/2/document`,
      { document: changed },
      'admin',
      { 'if-match': `"${String(current.version)}"` },
    );
    expect(edit.statusCode, edit.body).toBe(200);
    // Resubmission starts a new review round (old votes do not count).
    expect(
      (
        await call('POST', `/v1/scripts/${script.id}/versions/2/submit`, {
          changeNote: 'Second review',
        })
      ).json(),
    ).toMatchObject({ state: 'in_review', reviewRound: 2, semver: '1.1.0' });

    const diff = (await call('GET', `/v1/scripts/${script.id}/versions/1/diff/2`)).json<{
      patch: unknown[];
      summary: { lines: string[] };
    }>();
    expect(diff.summary.lines).toContain('~ meta changed');
    expect(diff.patch).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/meta/description' })]),
    );
  });

  it('a pinned published version cannot be retired', async () => {
    const script = await newScript('Pinned');
    const v1 = await newVersion(script.id);
    await publish(script.id, 1, '1.0.0');
    const campaign = (
      await call('POST', '/v1/campaigns', { name: 'Pin campaign', status: 'active' })
    ).json<{ id: string }>();
    const assignment = await call('POST', '/v1/assignments', {
      scriptId: script.id,
      campaignId: campaign.id,
      versionPolicy: 'pinned',
      pinnedVersionId: v1.id,
    });
    expect(assignment.statusCode).toBe(201);
    const retire = await call('POST', `/v1/scripts/${script.id}/versions/1/retire`, {}, 'designer');
    expect(retire.json<{ code: string; errors: { path: string }[] }>()).toMatchObject({
      code: 'VERBIS_SCRIPT_VERSION_IN_USE',
      errors: [{ path: `/assignments/${assignment.json<{ id: string }>().id}` }],
    });
  });
});

describe('shared screens', () => {
  it('links into scripts, lists impact on update, and re-materializes on resave', async () => {
    const page = structuredClone(surveyScript.pages[surveyScript.pages.length - 1]) as Record<
      string,
      unknown
    >;
    const created = await call('POST', '/v1/shared-screens', {
      key: 'closing',
      name: 'Closing',
      fragment: { pages: [page] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const screenId = created.json<{ id: string }>().id;
    const script = await newScript('Uses shared');
    const v1 = await newVersion(script.id, surveyScript, [
      { sharedScreenId: screenId, mode: 'linked' },
    ]);
    const links = await owner.scriptScreenLink.findMany({ where: { scriptVersionId: v1.id } });
    expect(links).toEqual([expect.objectContaining({ mode: 'linked', pageIds: [page['id']] })]);

    const updated = { ...page, name: 'Closing v2' };
    const published = await call('POST', `/v1/shared-screens/${screenId}/versions`, {
      semver: '1.1.0',
      changeNote: 'new wording',
      fragment: { pages: [updated] },
    });
    expect(published.statusCode, published.body).toBe(201);
    const impact = published.json<{
      impact: { affected: { scriptId: string; outdated: boolean; action: string }[] };
    }>().impact;
    expect(impact.affected).toEqual([
      expect.objectContaining({ scriptId: script.id, outdated: true, action: 'resave_draft' }),
    ]);
    expect(
      (
        await call('POST', `/v1/shared-screens/${screenId}/versions`, {
          semver: '1.0.5',
          changeNote: 'x',
          fragment: { pages: [updated] },
        })
      ).statusCode,
    ).toBe(422);

    const current = (await call('GET', `/v1/scripts/${script.id}/versions/1`)).json<{
      version: number;
    }>();
    const resave = await call(
      'PUT',
      `/v1/scripts/${script.id}/versions/1/document`,
      { document: surveyScript, screens: [{ sharedScreenId: screenId, mode: 'linked' }] },
      'admin',
      { 'if-match': `"${String(current.version)}"` },
    );
    expect(resave.statusCode, resave.body).toBe(200);
    const doc = (await call('GET', `/v1/scripts/${script.id}/versions/1`)).json<{
      document: { pages: { id: string; name: string }[] };
    }>().document;
    expect(doc.pages.find((p) => p.id === page['id'])?.name).toBe('Closing v2');
    expect(
      (await call('GET', `/v1/shared-screens/${screenId}/impact`)).json<{
        affected: { outdated: boolean }[];
      }>().affected[0]?.outdated,
    ).toBe(false);
  });
});

describe('templates and packages', () => {
  it('instantiates a built-in template', async () => {
    const list = (await call('GET', '/v1/templates?category=survey')).json<
      { id: string; builtIn: boolean }[]
    >();
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'builtin-nps-survey', builtIn: true }),
      ]),
    );
    const res = await call('POST', '/v1/templates/builtin-nps-survey/instantiate', {
      name: 'My NPS',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      script: { name: 'My NPS' },
      version: { number: 1, state: 'draft' },
    });
  });

  it('exports a signed .verbis package and imports it into another tenant as a draft; tampering is rejected', async () => {
    const script = await newScript('Exported');
    const v1 = await newVersion(script.id, minimalScript());
    await publish(script.id, 1, '2.3.0');
    const exported = await call('POST', '/v1/script-packages/export', {
      items: [{ scriptId: script.id, versionNumber: 1 }],
      targetEnvironments: ['dev'],
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const pkg = exported.json<PackageJson>();
    expect(pkg).toMatchObject({
      format: 'verbis-package',
      formatVersion: 2,
      manifest: { sourceEnvironment: 'dev' },
      signature: { alg: 'EdDSA', kid: 'it-dev' },
    });

    const other = await createTenant(owner, kit, uniqueSlug('authoring-b'));
    const dry = await call(
      'POST',
      '/v1/script-packages/import?dryRun=true',
      pkg,
      'admin',
      {},
      other,
    );
    expect(dry.json()).toMatchObject({
      dryRun: true,
      plan: [{ name: 'Exported', action: 'create_script' }],
    });
    const imported = await call('POST', '/v1/script-packages/import', pkg, 'admin', {}, other);
    expect(imported.statusCode, imported.body).toBe(200);
    const created = imported.json<{ created: { versionId: string }[] }>().created[0]!;
    const row = await owner.scriptVersion.findUniqueOrThrow({ where: { id: created.versionId } });
    expect(row).toMatchObject({ state: 'draft', semver: '2.3.0', checksum: v1.checksum });
    expect(row.source).toMatchObject({ sourceEnvironment: 'dev', signatureKid: 'it-dev' });

    const tampered = structuredClone(pkg);
    const first = tampered.payload.scripts[0];
    if (first === undefined) throw new Error('package has no script');
    first.document.meta.name = 'evil';
    const rejected = await call('POST', '/v1/script-packages/import', tampered, 'admin', {}, other);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json<{ code: string }>().code).toBe('VERBIS_PACKAGE_INVALID');
    expect(
      await owner.auditEvent.findFirst({
        where: { tenantId: other.tenantId, action: 'script.package.imported' },
      }),
    ).not.toBeNull();
  });
});

describe('campaigns, assignments and the resolver', () => {
  it('campaign codes and external mappings are unique per tenant', async () => {
    const body = {
      name: 'Kart Satış Q4',
      status: 'active',
      channels: ['voice', 'chat'],
      locales: ['tr', 'en'],
      externalMappings: [
        { platform: 'genesys-cloud', kind: 'queue', externalId: 'q-123' },
        { platform: 'avaya-aes', kind: 'vdn', externalId: '7001' },
      ],
      workingHours: {
        timezone: 'Europe/Istanbul',
        weekly: { mon: [{ from: '09:00', to: '18:00' }] },
      },
      outcomeSet: [
        { code: 'SALE', label: 'Sale', category: 'success' },
        { code: 'CALLBACK', label: 'Call back', category: 'callback', requiresNote: true },
      ],
    };
    const created = await call('POST', '/v1/campaigns', body);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      code: 'KART_SATIS_Q4',
      locales: ['tr', 'en'],
      externalMappings: [{ platform: 'avaya-aes' }, { platform: 'genesys-cloud' }],
    });
    const clash = await call('POST', '/v1/campaigns', {
      name: 'Other',
      externalMappings: [{ platform: 'genesys-cloud', kind: 'queue', externalId: 'q-123' }],
    });
    expect(clash.statusCode).toBe(409);
    expect(
      (await call('POST', '/v1/campaigns', { name: 'Third', code: 'KART_SATIS_Q4' })).statusCode,
    ).toBe(409);
  });

  it('resolves deterministically with a trace, warns about conflicts, caches and invalidates', async () => {
    const campaign = (
      await call('POST', '/v1/campaigns', {
        name: 'Routing',
        code: 'ROUTING',
        status: 'active',
        channels: ['voice'],
        externalMappings: [{ platform: 'five9', kind: 'campaign', externalId: 'F9-77' }],
      })
    ).json<{ id: string }>();
    const general = await newScript('General');
    await newVersion(general.id);
    await publish(general.id, 1, '1.0.0');
    const vip = await newScript('VIP');
    await newVersion(vip.id);
    const vipV1 = await publish(vip.id, 1, '1.0.0');

    const a1 = (
      await call('POST', '/v1/assignments', {
        scriptId: general.id,
        campaignId: campaign.id,
        priority: 100,
      })
    ).json<{ id: string; warnings: unknown[] }>();
    expect(a1.warnings).toEqual([]);
    const a2 = (
      await call('POST', '/v1/assignments', {
        scriptId: vip.id,
        campaignId: campaign.id,
        priority: 100,
      })
    ).json<{ id: string; warnings: { severity: string }[] }>();
    expect(a2.warnings).toEqual([expect.objectContaining({ severity: 'certain' })]);
    expect(
      (await call('GET', `/v1/campaigns/${campaign.id}/assignment-conflicts`)).json(),
    ).toHaveLength(1);
    // Narrow the VIP assignment: higher priority, expression over attached data.
    const current = (await call('GET', `/v1/assignments/${a2.id}`)).json<{ version: number }>();
    const narrowed = await call(
      'PATCH',
      `/v1/assignments/${a2.id}`,
      { priority: 10, expression: { fact: 'interaction.vip', op: 'eq', value: true } },
      'admin',
      { 'if-match': `"${String(current.version)}"` },
    );
    expect(narrowed.statusCode, narrowed.body).toBe(200);

    const resolve = (body: Record<string, unknown>) =>
      call('POST', '/v1/script-resolutions', { channel: 'voice', ...body });
    const vipDecision = (
      await resolve({ campaignCode: 'ROUTING', attributes: { vip: true }, interactionId: 'i-1' })
    ).json<{
      outcome: string;
      assignmentId: string;
      version: { id: string };
      trace: { ranking: string[] };
      cache: string;
    }>();
    expect(vipDecision).toMatchObject({
      outcome: 'resolved',
      assignmentId: a2.id,
      version: { id: vipV1.id },
    });
    expect(vipDecision.trace.ranking).toEqual([a2.id, a1.id]);
    const regular = (
      await resolve({
        external: { platform: 'five9', kind: 'campaign', externalId: 'F9-77' },
        attributes: { vip: false },
      })
    ).json<{
      assignmentId: string;
      cache: string;
      trace: { evaluated: { assignmentId: string; reasons: string[] }[] };
    }>();
    expect(regular.assignmentId).toBe(a1.id);
    expect(regular.cache).toBe('hit');
    expect(regular.trace.evaluated.find((e) => e.assignmentId === a2.id)?.reasons).toEqual([
      'expression_false',
    ]);
    expect((await resolve({ campaignCode: 'ROUTING', channel: 'chat' })).json()).toMatchObject({
      outcome: 'no_match',
      reason: 'channel_not_in_campaign',
    });
    expect((await resolve({ campaignCode: 'NOPE' })).statusCode).toBe(404);
    expect((await resolve({ campaignCode: 'ROUTING', campaignId: campaign.id })).statusCode).toBe(
      400,
    );

    // No NATS invalidation is delivered: committed campaign and assignment writes are fresh immediately.
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { status: 'paused', version: { increment: 1 } },
    });
    expect((await resolve({ campaignCode: 'ROUTING' })).json()).toMatchObject({
      outcome: 'no_match',
      reason: 'campaign_inactive',
      cache: 'miss',
    });
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { status: 'active', channels: ['chat'], version: { increment: 1 } },
    });
    expect((await resolve({ campaignCode: 'ROUTING' })).json()).toMatchObject({
      outcome: 'no_match',
      reason: 'channel_not_in_campaign',
    });
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { channels: ['voice'], version: { increment: 1 } },
    });
    await owner.assignment.update({
      where: { id: a1.id },
      data: { priority: 0, version: { increment: 1 } },
    });
    expect(
      (await resolve({ campaignCode: 'ROUTING', attributes: { vip: true } })).json(),
    ).toMatchObject({ assignmentId: a1.id });
    await owner.assignment.update({
      where: { id: a1.id },
      data: { priority: 100, version: { increment: 1 } },
    });
    await owner.assignment.update({
      where: { id: a2.id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    expect(
      (await resolve({ campaignCode: 'ROUTING', attributes: { vip: true } })).json(),
    ).toMatchObject({ assignmentId: a1.id });
    await owner.assignment.update({
      where: { id: a2.id },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { workingHours: { malformed: true }, version: { increment: 1 } },
    });
    const invalidHours = await resolve({ campaignCode: 'ROUTING' });
    expect(invalidHours.statusCode).toBe(503);
    expect(invalidHours.json()).toMatchObject({ code: 'VERBIS_ROUTING_CONFIGURATION_INVALID' });
    await owner.campaign.update({
      where: { id: campaign.id },
      data: {
        workingHours: { timezone: 'UTC', weekly: {}, holidays: [] },
        version: { increment: 1 },
      },
    });
    expect((await resolve({ campaignCode: 'ROUTING' })).json()).toMatchObject({
      outcome: 'no_match',
      reason: 'outside_working_hours',
    });
    await owner.campaign.update({
      where: { id: campaign.id },
      data: {
        workingHours: {
          timezone: 'UTC',
          weekly: {
            mon: [{ from: '00:00', to: '24:00' }],
            tue: [{ from: '00:00', to: '24:00' }],
            wed: [{ from: '00:00', to: '24:00' }],
            thu: [{ from: '00:00', to: '24:00' }],
            fri: [{ from: '00:00', to: '24:00' }],
            sat: [{ from: '00:00', to: '24:00' }],
            sun: [{ from: '00:00', to: '24:00' }],
          },
          holidays: [],
        },
        version: { increment: 1 },
      },
    });

    // Publishing v2 of General: until invalidated the cached snapshot is served; the
    // invalidator (normally driven by the outbox → JetStream event) makes the next read fresh.
    await newVersion(general.id);
    const generalV2 = await publish(general.id, 2, '1.1.0');
    await requestContext.run({ requestId: 'x', correlationId: 'x', ip: '', userAgent: '' }, () =>
      app.get(ResolverCacheInvalidator).handle({
        id: crypto.randomUUID(),
        type: 'verbis.scripts.version.published.v1',
        tenantId: t.tenantId,
        aggregate: { type: 'ScriptVersion', id: generalV2.id },
        occurredAt: new Date().toISOString(),
        correlationId: 'x',
        actor: 'system',
        payload: {},
      }),
    );
    const fresh = (await resolve({ campaignCode: 'ROUTING' })).json<{
      cache: string;
      version: { id: string };
    }>();
    expect(fresh).toMatchObject({ cache: 'miss', version: { id: generalV2.id } });

    const audit = await owner.auditEvent.findMany({
      where: { tenantId: t.tenantId, action: 'routing.script.resolved', targetId: campaign.id },
    });
    expect(audit.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('"vip"');
  });
});

describe('preview regression publication gate', () => {
  it('saves synthetic scenarios in a version and refuses submit when its expected outcome fails', async () => {
    const script = await newScript('Synthetic regression gate');
    const document = minimalScript();
    document.testScenarios = [
      {
        id: 'mustEnd',
        name: 'Must end',
        synthetic: true,
        context: {},
        steps: [],
        expected: { ended: true },
      },
    ];
    await newVersion(script.id, document);
    const path = `/v1/scripts/${script.id}/versions/1`;
    const report = await call('POST', `${path}/regression`, {});
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      passed: false,
      results: [{ id: 'mustEnd', passed: false }],
    });
    expect(
      (await call('POST', `${path}/submit`, { semver: '1.0.0', changeNote: 'Synthetic gate' }))
        .statusCode,
    ).toBe(400);
    const approve = await call('POST', `${path}/reviews`, { decision: 'approved' }, 'designer');
    expect(approve.statusCode).toBe(409);
    expect(approve.json()).toMatchObject({ code: 'VERBIS_SCRIPT_INVALID_TRANSITION' });
    expect((await call('GET', path)).json()).toMatchObject({ state: 'draft' });
  });
});

describe('team lifecycle and transport', () => {
  it('requires a non-empty submission note at the HTTP edge', async () => {
    const script = await newScript('Mandatory release note');
    await newVersion(script.id, minimalScript());
    const response = await call('POST', `/v1/scripts/${script.id}/versions/1/submit`, {
      semver: '1.0.0',
    });
    expect(response.statusCode).toBe(400);
  });
  it('rolls the release head back without mutating published documents or explicit pins', async () => {
    const script = await newScript('Rollback head'),
      v1 = await newVersion(script.id, minimalScript());
    await publish(script.id, 1, '1.0.0');
    const v2 = await newVersion(script.id, minimalScript());
    await publish(script.id, 2, '1.1.0');
    const rollback = await call(
      'POST',
      `/v1/scripts/${script.id}/rollback`,
      { targetNumber: 1, expectedCurrentVersionId: v2.id },
      'designer',
    );
    expect(rollback.statusCode, rollback.body).toBe(200);
    expect((await call('GET', `/v1/scripts/${script.id}`)).json()).toMatchObject({
      currentVersionId: v1.id,
    });
    expect((await call('GET', `/v1/scripts/${script.id}/versions/2`)).json()).toMatchObject({
      state: 'published',
      checksum: v2.checksum,
    });
    const stale = await call(
      'POST',
      `/v1/scripts/${script.id}/rollback`,
      { targetNumber: 1, expectedCurrentVersionId: v2.id },
      'designer',
    );
    expect(stale.statusCode).toBe(409);
  });
  it('persists node comment replies with optimistic resolution and tenant isolation', async () => {
    const script = await newScript('Node threads');
    await newVersion(script.id, minimalScript());
    const base = `/v1/scripts/${script.id}/versions/1/comments`;
    const created = await call('POST', base, {
      nodeId: 'btn-next',
      text: 'Synthetic review',
      mentions: [],
    });
    expect(created.statusCode).toBe(201);
    const thread = created.json<{ id: string; version: number }>();
    const reply = await call('POST', `${base}/${thread.id}/replies`, {
      text: 'Synthetic response',
      mentions: [],
    });
    expect(reply.statusCode).toBe(200);
    const changed = reply.json<{ version: number }>();
    const stale = await call('POST', `${base}/${thread.id}/resolve`, {
      resolved: true,
      version: thread.version,
    });
    expect(stale.statusCode).toBe(412);
    const resolve = await call('POST', `${base}/${thread.id}/resolve`, {
      resolved: true,
      version: changed.version,
    });
    expect(resolve.statusCode).toBe(200);
    const other = await createTenant(owner, kit, uniqueSlug('thread-isolation'));
    expect((await call('GET', base, undefined, 'admin', {}, other)).statusCode).toBe(404);
  });
  it('rolls back every bulk assignment update when a later operation conflicts', async () => {
    const script = await newScript('Atomic assignments');
    await newVersion(script.id, minimalScript());
    const campaign = (await call('POST', '/v1/campaigns', { name: 'Atomic campaign' })).json<{
      id: string;
    }>();
    const first = (
      await call('POST', '/v1/assignments', {
        scriptId: script.id,
        campaignId: campaign.id,
        priority: 20,
      })
    ).json<{ id: string; version: number }>();
    const second = (
      await call('POST', '/v1/assignments', {
        scriptId: script.id,
        campaignId: campaign.id,
        priority: 40,
      })
    ).json<{ id: string; version: number }>();
    const batch = await call('POST', '/v1/assignments/batch', {
      updates: [
        { id: first.id, version: first.version, patch: { priority: 0 } },
        { id: second.id, version: second.version + 1, patch: { priority: 10 } },
      ],
    });
    expect(batch.statusCode).toBe(412);
    expect((await call('GET', `/v1/assignments/${first.id}`)).json()).toMatchObject({
      priority: 20,
      version: first.version,
    });
  });
  it('ships six industry templates and fails closed when collaborative editing is disabled', async () => {
    const rows = (await call('GET', '/v1/templates')).json<{ tags: string[] }[]>();

    for (const sector of ['banking', 'telecom', 'insurance', 'ecommerce', 'collections', 'survey'])
      expect(rows.some((row) => row.tags.includes(sector))).toBe(true);
    const script = await newScript('Disabled collaboration');
    await newVersion(script.id, minimalScript());
    const ticket = await call(
      'POST',
      `/v1/scripts/${script.id}/versions/1/collaboration/ticket`,
      {},
    );
    expect(ticket.statusCode).toBe(400);
  });
});

it('rejects a null assignment request with 400 and leaves tenant assignments untouched', async () => {
  const before = await owner.assignment.count({ where: { tenantId: t.tenantId } });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/assignments',
    headers: { ...json, ...(await t.auth()) },
    payload: 'null',
  });
  expect(response.statusCode, response.body).toBe(400);
  expect(await owner.assignment.count({ where: { tenantId: t.tenantId } })).toBe(before);
});

it('publishes a Designer-bound tenant data source with its pinned metadata (D-16)', async () => {
  const source = await owner.dataSource.create({
    data: {
      tenantId: t.tenantId,
      key: 'customer-profile',
      version: 3,
      protocol: 'rest',
      definition: {
        baseUrl: 'https://customer.example.io',
        endpoint: '/profile',
        auth: { type: 'none' },
        profiles: { prod: { baseUrl: 'https://customer.example.io', auth: { type: 'none' } } },
      },
      secretRefs: [],
      createdBy: 'fixture-approved',
      updatedBy: 'fixture-approved',
    },
  });
  const metadata = await call('GET', '/v1/data-sources?limit=100');
  expect(metadata.statusCode).toBe(200);
  expect(metadata.json<{ data: unknown[] }>().data).toContainEqual(
    expect.objectContaining({ id: source.id, key: source.key, version: 3 }),
  );
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.dataSources = ScriptDocumentSchema.parse({
    ...document,
    dataSources: [
      {
        id: 'customerProfile',
        ref: 'tenant-datasource:customer-profile',
        version: 3,
        inputs: {},
        outputs: {},
        policy: { timeoutMs: 5000 },
      },
    ],
  }).dataSources;
  document.pages[0]!.layout.children!.push({
    id: 'customer-service',
    type: 'webService',
    props: { ds: 'customerProfile', trigger: 'manual' },
    bindings: [],
    events: {},
    children: [],
  });
  const script = await newScript('Designer source binding');
  const version = await newVersion(script.id, document);
  await publish(script.id, version.number, '1.0.0');
  const persisted = await call('GET', `/v1/scripts/${script.id}/versions/${version.number}`);
  expect(
    persisted.json<{ document: { dataSources: unknown[] } }>().document.dataSources,
  ).toContainEqual(
    expect.objectContaining({ ref: 'tenant-datasource:customer-profile', version: 3 }),
  );
});
it('loads a durable Yjs recovery copy and hides it from other tenants (M-14)', async () => {
  const script = await newScript('Durable collaboration recovery');
  const version = await newVersion(script.id, minimalScript());
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.meta.name = 'Recovered debounce window';
  const newer = releaseFixture(minimalScript());
  newer.meta.name = 'Newer REST draft';
  const advanced = await call(
    'PUT',
    `/v1/scripts/${script.id}/versions/${version.number}/document`,
    { document: newer, screens: [] },
    'admin',
    { 'if-match': `"${version.version}"` },
  );
  expect(advanced.statusCode, advanced.body).toBe(200);
  const service = app.get(CollaborationService),
    leases = app.get(DraftLeaseService);
  const broadcast: string[] = [];
  const ydoc = Object.assign(new Y.Doc(), {
    broadcastStateless: (payload: string) => {
      broadcast.push(payload);
    },
  });
  initializeDocument(ydoc, document);
  const room = {
    grant: {
      tenantId: t.tenantId,
      userId: t.adminId,
      bffId: t.adminId,
      bffHash: '0'.repeat(64),
      origin: 'http://localhost',
      expiresAt: Date.now() + 30_000,
      scriptId: script.id,
      number: version.number,
      documentName: '',
    },
    version: version.version,
    lease: leases.key(t.tenantId, script.id, version.number),
    document: ydoc as unknown as Document,
    frozen: false,
    recoveryId: undefined as string | undefined,
    contributors: new Set([t.adminId]),
    owners: new Map<number, string>(),
  };
  const internals = service as unknown as {
    owner: string;
    rooms: Map<string, typeof room>;
    name: (tenant: string, script: string, number: number) => string;
  };
  const roomName = internals.name(t.tenantId, script.id, version.number);
  room.grant.documentName = roomName;
  await leases.claim(t.tenantId, script.id, version.number, internals.owner);
  internals.rooms.set(roomName, room);
  try {
    const flush = await call(
      'POST',
      `/v1/scripts/${script.id}/versions/${version.number}/collaboration/flush`,
      {},
    );
    expect(flush.statusCode, flush.body).toBe(409);
    expect(room.frozen).toBe(true);
    expect(room.recoveryId).toBeTruthy();
    expect(broadcast.some((payload) => payload.includes(room.recoveryId!))).toBe(true);
    await service.persist(roomName, room.document);
    expect(
      await owner.collaborationConflict.count({
        where: { tenantId: t.tenantId, scriptVersionId: version.id },
      }),
    ).toBe(1);
    expect(
      await owner.auditEvent.count({
        where: {
          tenantId: t.tenantId,
          action: 'script.collaboration.conflictPreserved',
          targetId: version.id,
        },
      }),
    ).toBe(1);
  } finally {
    internals.rooms.delete(roomName);
    await leases.release(room.lease, internals.owner);
    ydoc.destroy();
  }
  const copy = await owner.collaborationConflict.findFirstOrThrow({
    where: { tenantId: t.tenantId, scriptVersionId: version.id },
  });
  const path = `/v1/scripts/${script.id}/versions/${version.number}/collaboration/conflicts`;
  expect((await call('GET', path)).json()).toContainEqual(
    expect.objectContaining({ id: copy.id, baseVersion: 1, currentVersion: 2 }),
  );
  const recovered = await call('GET', `${path}/${copy.id}`);
  expect(recovered.statusCode, recovered.body).toBe(200);
  expect(recovered.json<{ document: { meta: { name: string } } }>().document.meta.name).toBe(
    'Recovered debounce window',
  );
  const other = await createTenant(owner, kit, uniqueSlug('recovery-other'));
  expect([403, 404]).toContain(
    (await call('GET', `${path}/${copy.id}`, undefined, 'admin', {}, other)).statusCode,
  );
  expect(
    (await call('GET', `/v1/scripts/${script.id}/versions/${version.number}`)).json<{
      document: { meta: { name: string } };
    }>().document.meta.name,
  ).toBe('Newer REST draft');
});

describe('tenant onboarding bundle', () => {
  it('is atomic and idempotent, creates draft/disabled resources and rejects authors', async () => {
    const denied = await call('POST', '/v1/tenant/onboarding', { name: 'Setup' }, 'designer');
    expect(denied.statusCode).toBe(403);
    const first = await call('POST', '/v1/tenant/onboarding', { name: 'Setup' });
    expect(first.statusCode).toBe(201);
    const ids = first.json<{
      campaignId: string;
      scriptId: string;
      versionId: string;
      connectorId: string;
      assignmentId: string;
      created: boolean;
    }>();
    expect(ids.created).toBe(true);
    const again = await call('POST', '/v1/tenant/onboarding', { name: 'Different name' });
    expect(again.json()).toEqual({ ...ids, created: false });
    expect((await owner.campaign.findUniqueOrThrow({ where: { id: ids.campaignId } })).status).toBe(
      'draft',
    );
    expect(
      (await owner.scriptVersion.findUniqueOrThrow({ where: { id: ids.versionId } })).state,
    ).toBe('draft');
    expect(
      (await owner.connector.findUniqueOrThrow({ where: { id: ids.connectorId } })).status,
    ).toBe('disabled');
    const audit = await owner.auditEvent.findFirst({
      where: { tenantId: t.tenantId, action: 'tenancy.tenant.onboarded' },
    });
    expect(audit).not.toBeNull();
    const outbox = await owner.outboxEvent.findFirst({
      where: { tenantId: t.tenantId, eventType: 'verbis.tenancy.tenant.onboarded.v1' },
    });
    expect(outbox).not.toBeNull();
  });
});
