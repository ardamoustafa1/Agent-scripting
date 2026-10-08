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
interface Doc {
  pages: { name: string }[];
  variables: { key: string }[];
}
interface Version {
  number: number;
  version: number;
  document: Doc;
  branch: string | null;
}

async function script() {
  const tenant = await createTenant(owner, kit, uniqueSlug('branch'));
  const headers = { ...json, ...(await tenant.auth()) };
  const created = (
    await app.inject({ method: 'POST', url: '/v1/scripts', headers, payload: { name: 'Branched' } })
  ).json<{ id: string }>();
  const base = `/v1/scripts/${created.id}`;
  const first = await app.inject({
    method: 'POST',
    url: `${base}/versions`,
    headers,
    payload: { document: surveyScript },
  });
  expect(first.statusCode).toBe(201);
  const get = async (number: number) =>
    (
      await app.inject({ method: 'GET', url: `${base}/versions/${number}`, headers })
    ).json<Version>();
  /** Saves `change` applied to the current document of a draft version. */
  const edit = async (number: number, change: (doc: Doc) => void) => {
    const current = await get(number);
    const next = structuredClone(current.document);
    change(next);
    const response = await app.inject({
      method: 'PUT',
      url: `${base}/versions/${number}/document`,
      headers: { ...headers, 'if-match': `"${String(current.version)}"` },
      payload: { document: next },
    });
    expect(response.statusCode).toBe(200);
  };
  const newMainline = async (change: (doc: Doc) => void) => {
    const latest = await get(
      Math.max(
        ...(
          await owner.scriptVersion.findMany({
            where: { scriptId: created.id, branch: null },
            select: { number: true },
          })
        ).map((v) => v.number),
      ),
    );
    const next = structuredClone(latest.document);
    change(next);
    const response = await app.inject({
      method: 'POST',
      url: `${base}/versions`,
      headers,
      payload: { document: next },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ number: number }>().number;
  };
  return { tenant, headers, base, scriptId: created.id, get, edit, newMainline };
}
const branch = (s: Awaited<ReturnType<typeof script>>, name: string, fromNumber: number) =>
  app.inject({
    method: 'POST',
    url: `${s.base}/branches`,
    headers: s.headers,
    payload: { name, fromNumber },
  });

describe('script branches (ADR-0051 C3)', () => {
  it('creates a branch, merges it into a new mainline draft with both sides, and audits it', async () => {
    const s = await script();
    const created = await branch(s, 'november', 1);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'november',
      versionNumber: 2,
      parentNumber: 1,
      mergedInto: null,
    });
    expect((await s.get(2)).branch).toBe('november');
    expect((await s.get(1)).branch).toBeNull();

    await s.edit(2, (doc) => {
      if (doc.pages[0]) doc.pages[0].name = 'November welcome';
    });
    const mainline = await s.newMainline((doc) => {
      doc.variables.push({ key: 'mainlineVariable', type: 'string', scope: 'session' } as never);
    });
    expect(mainline).toBe(3);

    const preview = (
      await app.inject({
        method: 'GET',
        url: `${s.base}/branches/november/merge-preview`,
        headers: s.headers,
      })
    ).json<{
      canMerge: boolean;
      conflicts: unknown[];
      baseNumber: number;
      mainlineNumber: number;
    }>();
    expect(preview).toMatchObject({
      canMerge: true,
      conflicts: [],
      baseNumber: 1,
      mainlineNumber: 3,
    });

    const merged = await app.inject({
      method: 'POST',
      url: `${s.base}/branches/november/merge`,
      headers: s.headers,
      payload: {},
    });
    expect(merged.statusCode).toBe(200);
    const result = merged.json<{ number: number; state: string; branch: string | null }>();
    expect(result).toMatchObject({ number: 4, state: 'draft', branch: null });
    const document = (await s.get(4)).document;
    expect(document.pages[0]?.name).toBe('November welcome');
    expect(document.variables.map((v) => v.key)).toContain('mainlineVariable');

    const listed = (
      await app.inject({ method: 'GET', url: `${s.base}/branches`, headers: s.headers })
    ).json<{ name: string; mergedInto: number | null }[]>();
    expect(listed).toMatchObject([{ name: 'november', mergedInto: 4 }]);
    const again = await app.inject({
      method: 'POST',
      url: `${s.base}/branches/november/merge`,
      headers: s.headers,
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('VERBIS_BRANCH_MERGED');

    const actions = (
      await owner.auditEvent.findMany({
        where: { tenantId: s.tenant.tenantId, action: { startsWith: 'script.branch.' } },
        orderBy: { occurredAt: 'asc' },
        select: { action: true },
      })
    ).map((event) => event.action);
    expect(actions).toEqual(['script.branch.created', 'script.branch.merged']);
  });

  it('needs an explicit choice for every conflict, then applies exactly that choice', async () => {
    const s = await script();
    expect((await branch(s, 'redesign', 1)).statusCode).toBe(201);
    await s.edit(2, (doc) => {
      if (doc.pages[0]) doc.pages[0].name = 'Branch name';
    });
    await s.newMainline((doc) => {
      if (doc.pages[0]) doc.pages[0].name = 'Mainline name';
    });
    const preview = (
      await app.inject({
        method: 'GET',
        url: `${s.base}/branches/redesign/merge-preview`,
        headers: s.headers,
      })
    ).json<{
      conflicts: { path: string; kind: string; ours: string; theirs: string; base: string }[];
    }>();
    expect(preview.conflicts).toHaveLength(1);
    const conflict = preview.conflicts[0];
    expect(conflict).toMatchObject({
      kind: 'both-changed',
      ours: '"Mainline name"',
      theirs: '"Branch name"',
    });
    const path = conflict?.path ?? '';
    expect(path).toMatch(/^\/pages\/.+\/name$/);
    const merge = (resolutions: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: `${s.base}/branches/redesign/merge`,
        headers: s.headers,
        payload: { resolutions },
      });

    // Nothing chosen: refused, listing what needs a choice, and nothing is created.
    const refused = await merge({});
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string; errors: { path: string }[] }>()).toMatchObject({
      code: 'VERBIS_BRANCH_CONFLICT',
      errors: [{ path }],
    });
    // A resolution for something that is not a conflict is a client error, also creating nothing.
    expect((await merge({ [path]: 'theirs', '/pages/none/name': 'ours' })).statusCode).toBe(400);
    expect((await merge({ [path]: 'both' })).statusCode).toBe(400);
    expect(await owner.scriptVersion.count({ where: { scriptId: s.scriptId, branch: null } })).toBe(
      2,
    );

    // Choosing the branch applies the branch's text.
    const merged = await merge({ [path]: 'theirs' });
    expect(merged.statusCode).toBe(200);
    expect((await s.get(merged.json<{ number: number }>().number)).document.pages[0]?.name).toBe(
      'Branch name',
    );
    const audit = await owner.auditEvent.findFirst({
      where: { tenantId: s.tenant.tenantId, action: 'script.branch.merged' },
    });
    expect(JSON.stringify(audit?.diff)).toContain(`${path}=theirs`);
  });

  it('keeps the mainline text when the mainline side is chosen', async () => {
    const s = await script();
    expect((await branch(s, 'alt', 1)).statusCode).toBe(201);
    await s.edit(2, (doc) => {
      if (doc.pages[0]) doc.pages[0].name = 'Branch name';
    });
    await s.newMainline((doc) => {
      if (doc.pages[0]) doc.pages[0].name = 'Mainline name';
    });
    const path = (
      await app.inject({
        method: 'GET',
        url: `${s.base}/branches/alt/merge-preview`,
        headers: s.headers,
      })
    ).json<{ conflicts: { path: string }[] }>().conflicts[0]?.path;
    const merged = await app.inject({
      method: 'POST',
      url: `${s.base}/branches/alt/merge`,
      headers: s.headers,
      payload: { resolutions: { [path ?? '']: 'ours' } },
    });
    expect(merged.statusCode).toBe(200);
    expect((await s.get(merged.json<{ number: number }>().number)).document.pages[0]?.name).toBe(
      'Mainline name',
    );
  });

  it('never publishes a branch, and validates names, parents and ownership', async () => {
    const s = await script();
    expect((await branch(s, 'experiment', 1)).statusCode).toBe(201);
    const submit = await app.inject({
      method: 'POST',
      url: `${s.base}/versions/2/submit`,
      headers: s.headers,
      payload: { semver: '1.1.0', changeNote: 'Try to publish a branch' },
    });
    expect(submit.statusCode).toBe(409);
    expect(submit.json<{ code: string }>().code).toBe('VERBIS_BRANCH_NOT_PUBLISHABLE');

    const duplicate = await branch(s, 'experiment', 1);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ code: string }>().code).toBe('VERBIS_BRANCH_EXISTS');
    expect((await branch(s, 'Not Valid', 1)).statusCode).toBe(400);
    expect((await branch(s, 'from-branch', 2)).statusCode).toBe(400);
    expect((await branch(s, 'missing-parent', 99)).statusCode).toBe(404);

    const other = await createTenant(owner, kit, uniqueSlug('branch-other'));
    const foreign = await app.inject({
      method: 'GET',
      url: `${s.base}/branches`,
      headers: { ...json, ...(await other.auth()) },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
