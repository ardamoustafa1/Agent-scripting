import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { surveyScript } from '@verbis/script-schema/fixtures';

import { createTokenKit, type TokenKit } from '../support/tokens.js';

import { createTenant, integrationEnv, ownerPrisma, startApp, uniqueSlug } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let owner: PrismaClient, app: NestFastifyApplication, kit: TokenKit;
beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(integrationEnv(kit.jwks));
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

const json = { 'content-type': 'application/json' };
async function publishedScript(name: string, variables: object[]) {
  const tenant = await createTenant(owner, kit, uniqueSlug('compliance'));
  const headers = { ...json, ...(await tenant.auth()) };
  const script = (
    await app.inject({ method: 'POST', url: '/v1/scripts', headers, payload: { name } })
  ).json<{ id: string }>();
  const created = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions`,
    headers,
    payload: {
      document: { ...surveyScript, variables: [...(surveyScript.variables ?? []), ...variables] },
    },
  });
  expect(created.statusCode).toBe(201);
  const version = created.json<{ id: string }>();
  // The review/approval workflow has its own suites; this fixture marks the version published.
  await owner.scriptVersion.update({
    where: { id: version.id },
    data: { state: 'published', publishedAt: new Date() },
  });
  await owner.script.update({ where: { id: script.id }, data: { currentVersionId: version.id } });
  return { tenant, script };
}

describe('processing record (G2)', () => {
  it('lists only classified variables of published versions, escapes formulas, and audits the export', async () => {
    const { tenant, script } = await publishedScript('=HYPERLINK("x")', [
      {
        key: 'customerName',
        type: 'string',
        scope: 'session',
        classification: 'pii',
        persist: true,
      },
      { key: 'cardRef', type: 'string', scope: 'session', classification: 'pci' },
      { key: 'plainCounter', type: 'number', scope: 'session' },
    ]);
    const csv = await app.inject({
      method: 'GET',
      url: '/v1/compliance/processing-record?format=csv',
      headers: await tenant.auth(),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.body).toContain('"customerName"');
    expect(csv.body).toContain('"cardRef"');
    expect(csv.body).not.toContain('plainCounter');
    // Spreadsheet formula injection guard on tenant-authored names.
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);
    const body = (
      await app.inject({
        method: 'GET',
        url: '/v1/compliance/processing-record?format=json',
        headers: await tenant.auth(),
      })
    ).json<{
      scripts: number;
      truncated: boolean;
      rows: { variable: string; scriptId: string; persisted: boolean }[];
    }>();
    expect(body).toMatchObject({ scripts: 1, truncated: false });
    expect(body.rows.map((r) => r.variable).sort()).toEqual(
      expect.arrayContaining(['cardRef', 'customerName']),
    );
    expect(body.rows.every((r) => r.scriptId === script.id)).toBe(true);
    expect(body.rows.find((r) => r.variable === 'customerName')?.persisted).toBe(true);
    const audits = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId, action: 'compliance.processingRecord.exported' },
      orderBy: { seq: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.metadata).toMatchObject({ format: 'csv', scripts: 1 });
  });
  it('is tenant scoped, excludes drafts, and denies callers without export permission', async () => {
    const other = await publishedScript('Other tenant', [
      { key: 'otherSecret', type: 'string', scope: 'session', classification: 'pii' },
    ]);
    const { tenant } = await publishedScript('Mine', []);
    const mine = (
      await app.inject({
        method: 'GET',
        url: '/v1/compliance/processing-record?format=json',
        headers: await tenant.auth(),
      })
    ).json<{ rows: { variable: string }[] }>();
    expect(mine.rows.map((r) => r.variable)).not.toContain('otherSecret');
    expect(other.script.id).not.toBe('');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/compliance/processing-record',
      headers: await tenant.auth(tenant.designerId),
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/compliance/processing-record?format=pdf',
      headers: await tenant.auth(),
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('merge preview (C3)', () => {
  async function versions(mutate: ((doc: typeof surveyScript) => object)[]) {
    const tenant = await createTenant(owner, kit, uniqueSlug('merge'));
    const headers = { ...json, ...(await tenant.auth()) };
    const script = (
      await app.inject({ method: 'POST', url: '/v1/scripts', headers, payload: { name: 'Merge' } })
    ).json<{ id: string }>();
    const numbers: number[] = [];
    for (const change of [(d: typeof surveyScript) => d, ...mutate]) {
      const created = await app.inject({
        method: 'POST',
        url: `/v1/scripts/${script.id}/versions`,
        headers,
        payload: { document: change(structuredClone(surveyScript)) },
      });
      expect(created.statusCode, created.body).toBe(201);
      numbers.push(created.json<{ number: number }>().number);
    }
    const preview = (body: object) =>
      app.inject({
        method: 'POST',
        url: `/v1/scripts/${script.id}/merge-preview`,
        headers,
        payload: body,
      });
    return { tenant, script, numbers, preview, headers };
  }
  const withVariable = (key: string) => (d: typeof surveyScript) => ({
    ...d,
    variables: [...(d.variables ?? []), { key, type: 'string', scope: 'session' }],
  });
  const renamed = (name: string) => (d: typeof surveyScript) => ({
    ...d,
    meta: { ...d.meta, name },
  });

  it('merges independent edits of two versions against their common base', async () => {
    const r = await versions([renamed('Ours name'), withVariable('fromTheirs')]);
    const [base, ours, theirs] = r.numbers;
    const res = await r.preview({ base, ours, theirs });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      conflicts: unknown[];
      issues: string[];
      document: { meta: { name: string }; variables: { key: string }[] };
    }>();
    expect(body.conflicts).toEqual([]);
    expect(body.issues).toEqual([]);
    expect(body.document.meta.name).toBe('Ours name');
    expect(body.document.variables.map((v) => v.key)).toContain('fromTheirs');
  });
  it('reports conflicts without storing anything', async () => {
    const r = await versions([renamed('Ours name'), renamed('Theirs name')]);
    const [base, ours, theirs] = r.numbers;
    const body = (await r.preview({ base, ours, theirs })).json<{
      conflicts: { path: string; kind: string }[];
    }>();
    expect(body.conflicts).toMatchObject([{ path: '/meta/name', kind: 'both-changed' }]);
    const stored = await owner.scriptVersion.count({ where: { scriptId: r.script.id } });
    expect(stored).toBe(3);
  });
  it('validates input, unknown versions and permission', async () => {
    const r = await versions([renamed('A'), renamed('B')]);
    const [base, ours] = r.numbers;
    expect((await r.preview({ base, ours, theirs: ours })).statusCode).toBe(400);
    expect((await r.preview({ base, ours, theirs: 99 })).statusCode).toBe(404);
    expect((await r.preview({ base, ours, theirs: 3, extra: true })).statusCode).toBe(400);
    const anonymous = await app.inject({
      method: 'POST',
      url: `/v1/scripts/${r.script.id}/merge-preview`,
      headers: json,
      payload: { base: 1, ours: 2, theirs: 3 },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
