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
interface Suggestion {
  id: string;
  state: string;
  title: string;
}

async function draft() {
  const tenant = await createTenant(owner, kit, uniqueSlug('suggest'));
  const admin = { ...json, ...(await tenant.auth()) };
  const designer = { ...json, ...(await tenant.auth(tenant.designerId)) };
  const script = (
    await app.inject({
      method: 'POST',
      url: '/v1/scripts',
      headers: admin,
      payload: { name: 'Suggested script' },
    })
  ).json<{ id: string }>();
  const created = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions`,
    headers: admin,
    payload: { document: surveyScript },
  });
  expect(created.statusCode).toBe(201);
  const base = `/v1/scripts/${script.id}/versions/${created.json<{ number: number }>().number}`;
  return { tenant, admin, designer, script, base, versionId: created.json<{ id: string }>().id };
}
const rename = (name: unknown) => ({
  title: 'Rename the first page',
  note: 'Clearer for agents',
  operations: [{ op: 'replace', path: '/pages/0/name', value: name }],
});

describe('suggestion mode (ADR-0051)', () => {
  it('lets a collaborator propose, the owner apply once, and audits both steps', async () => {
    const { tenant, admin, designer, base, versionId } = await draft();
    const proposed = await app.inject({
      method: 'POST',
      url: `${base}/suggestions`,
      headers: designer,
      payload: rename('Welcome page'),
    });
    expect(proposed.statusCode).toBe(201);
    const suggestion = proposed.json<Suggestion>();
    expect(suggestion).toMatchObject({ state: 'open', title: 'Rename the first page' });

    const before = (await app.inject({ method: 'GET', url: base, headers: admin })).json<{
      version: number;
      document: { pages: { name: string }[] };
    }>();
    expect(before.document.pages[0]?.name).not.toBe('Welcome page');

    const accepted = await app.inject({
      method: 'POST',
      url: `${base}/suggestions/${suggestion.id}/accept`,
      headers: admin,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<Suggestion>().state).toBe('accepted');
    const after = (await app.inject({ method: 'GET', url: base, headers: admin })).json<{
      version: number;
      document: { pages: { name: string }[] };
    }>();
    expect(after.document.pages[0]?.name).toBe('Welcome page');
    expect(after.version).toBe(before.version + 1);

    // Deciding twice is refused.
    const again = await app.inject({
      method: 'POST',
      url: `${base}/suggestions/${suggestion.id}/accept`,
      headers: admin,
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('VERBIS_SUGGESTION_NOT_OPEN');

    const actions = (
      await owner.auditEvent.findMany({
        where: { tenantId: tenant.tenantId, action: { startsWith: 'script.suggestion.' } },
        orderBy: { occurredAt: 'asc' },
        select: { action: true },
      })
    ).map((event) => event.action);
    expect(actions).toEqual(['script.suggestion.created', 'script.suggestion.accepted']);
    expect(
      await owner.scriptSuggestion.count({
        where: { scriptVersionId: versionId, state: 'accepted' },
      }),
    ).toBe(1);
  });

  it('refuses suggestions that cannot apply or would break the document, without storing them', async () => {
    const { admin, base, versionId } = await draft();
    const missing = await app.inject({
      method: 'POST',
      url: `${base}/suggestions`,
      headers: admin,
      payload: {
        title: 'Missing page',
        operations: [{ op: 'replace', path: '/pages/99/name', value: 'x' }],
      },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json<{ code: string }>().code).toBe('VERBIS_SUGGESTION_INVALID');
    const invalid = await app.inject({
      method: 'POST',
      url: `${base}/suggestions`,
      headers: admin,
      payload: rename(12345),
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json<{ code: string }>().code).toBe('VERBIS_SUGGESTION_INVALID');
    const unsupported = await app.inject({
      method: 'POST',
      url: `${base}/suggestions`,
      headers: admin,
      payload: { title: 'Move', operations: [{ op: 'move', from: '/a', path: '/b' }] },
    });
    expect(unsupported.statusCode).toBe(400);
    expect(await owner.scriptSuggestion.count({ where: { scriptVersionId: versionId } })).toBe(0);
  });

  it('shows a suggestion as stale once the draft changed there, and refuses to apply it', async () => {
    const { admin, base } = await draft();
    const suggestion = (
      await app.inject({
        method: 'POST',
        url: `${base}/suggestions`,
        headers: admin,
        payload: rename('Suggested name'),
      })
    ).json<Suggestion>();
    // The owner edits the same field first.
    const current = (await app.inject({ method: 'GET', url: base, headers: admin })).json<{
      version: number;
      document: { pages: { name: string }[] };
    }>();
    const changed = structuredClone(current.document);
    if (changed.pages[0]) changed.pages[0].name = 'Owner name';
    const put = await app.inject({
      method: 'PUT',
      url: `${base}/document`,
      headers: { ...admin, 'if-match': `"${String(current.version)}"` },
      payload: { document: changed },
    });
    expect(put.statusCode).toBe(200);

    const listed = (
      await app.inject({ method: 'GET', url: `${base}/suggestions`, headers: admin })
    ).json<Suggestion[]>();
    expect(listed.map((s) => [s.id, s.state])).toEqual([[suggestion.id, 'stale']]);
    const refused = await app.inject({
      method: 'POST',
      url: `${base}/suggestions/${suggestion.id}/accept`,
      headers: admin,
      payload: {},
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('VERBIS_SUGGESTION_STALE');
    // The owner's text survived.
    const after = (await app.inject({ method: 'GET', url: base, headers: admin })).json<{
      document: { pages: { name: string }[] };
    }>();
    expect(after.document.pages[0]?.name).toBe('Owner name');
    // A stale suggestion can still be closed with a reason.
    const rejected = await app.inject({
      method: 'POST',
      url: `${base}/suggestions/${suggestion.id}/reject`,
      headers: admin,
      payload: { reason: 'Superseded by my edit' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json<Suggestion & { decisionReason: string }>()).toMatchObject({
      state: 'rejected',
      decisionReason: 'Superseded by my edit',
    });
  });

  it('accepts only on drafts and never leaks across tenants', async () => {
    const { admin, base, versionId } = await draft();
    const suggestion = (
      await app.inject({
        method: 'POST',
        url: `${base}/suggestions`,
        headers: admin,
        payload: rename('Another name'),
      })
    ).json<Suggestion>();
    await owner.scriptVersion.update({ where: { id: versionId }, data: { state: 'published' } });
    const accept = await app.inject({
      method: 'POST',
      url: `${base}/suggestions/${suggestion.id}/accept`,
      headers: admin,
      payload: {},
    });
    expect(accept.statusCode).toBe(409);
    expect(accept.json<{ code: string }>().code).toBe('VERBIS_SCRIPT_VERSION_IMMUTABLE');
    const create = await app.inject({
      method: 'POST',
      url: `${base}/suggestions`,
      headers: admin,
      payload: rename('Late name'),
    });
    expect(create.statusCode).toBe(409);

    const other = await createTenant(owner, kit, uniqueSlug('suggest-other'));
    const foreign = await app.inject({
      method: 'GET',
      url: `${base}/suggestions`,
      headers: { ...json, ...(await other.auth()) },
    });
    expect(foreign.statusCode).toBe(404);
    const unauthenticated = await app.inject({ method: 'GET', url: `${base}/suggestions` });
    expect(unauthenticated.statusCode).toBe(401);
  });
});

describe('suggestion notifications (D3)', () => {
  it('tells the owner about an open suggestion, never the author, and stops once it is decided', async () => {
    const { admin, designer, base } = await draft();
    const suggestion = (
      await app.inject({
        method: 'POST',
        url: `${base}/suggestions`,
        headers: designer,
        payload: rename('Notified name'),
      })
    ).json<Suggestion>();
    const feed = async (headers: Record<string, string>) =>
      (await app.inject({ method: 'GET', url: '/v1/authoring-notifications', headers })).json<
        { id: string; kind: string; number: number }[]
      >();
    expect((await feed(admin)).filter((n) => n.kind === 'suggestion')).toEqual([
      {
        id: `suggestion-${suggestion.id}`,
        kind: 'suggestion',
        number: 1,
        scriptId: expect.any(String) as string,
        createdAt: expect.any(String) as string,
      },
    ]);
    // The author is not notified about their own suggestion.
    expect((await feed(designer)).some((n) => n.kind === 'suggestion')).toBe(false);
    await app.inject({
      method: 'POST',
      url: `${base}/suggestions/${suggestion.id}/reject`,
      headers: admin,
      payload: {},
    });
    expect((await feed(admin)).some((n) => n.kind === 'suggestion')).toBe(false);
  });
});
