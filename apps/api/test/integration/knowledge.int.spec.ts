import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { requestContext } from '../../src/common/context/request-context.js';
import { uuidv7 } from '../../src/common/crypto/uuid.js';
import { TenantDb } from '../../src/infra/database/tenant-db.js';
import { KnowledgeDesktopController } from '../../src/modules/knowledge/knowledge-desktop.controller.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import { createTenant, integrationEnv, ownerPrisma, startApp, uniqueSlug } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

// ADR-0057: tenant knowledge articles, Turkish-aware full-text search and session-scoped reads.
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

interface Article {
  id: string;
  key: string;
  status: string;
  version: number;
}

async function fixture() {
  const tenant = await createTenant(owner, kit, uniqueSlug('knowledge'));
  const auth = await tenant.auth();
  const headers = { 'content-type': 'application/json', ...auth };
  const create = async (payload: Record<string, unknown>, publish = true) => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/knowledge-articles',
      headers,
      payload,
    });
    expect(created.statusCode).toBe(201);
    const article = created.json<Article>();
    if (!publish) return article;
    const published = await app.inject({
      method: 'POST',
      url: `/v1/knowledge-articles/${article.id}/publish`,
      headers: { ...auth, 'if-match': `"${String(article.version)}"` },
    });
    expect(published.statusCode).toBe(200);
    return published.json<Article>();
  };
  const search = async (q: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/v1/knowledge-articles/search?q=${encodeURIComponent(q)}`,
        headers,
      })
    ).json<{ results: { key: string; status: string; snippet: string }[] }>().results;
  return { tenant, auth, headers, create, search };
}

describe('knowledge articles on PostgreSQL (ADR-0057)', () => {
  it('finds articles Turkish-aware, by prefix, ranked, and falls back to any word', async () => {
    const f = await fixture();
    await f.create({
      key: 'refund-policy',
      title: 'İade politikası',
      body: 'Kredi kartı iadesi 14 gün içinde yapılır.\n\n## Adımlar\n- Talebi kaydedin',
      tags: ['iade', 'kart'],
    });
    await f.create({
      key: 'card-loss',
      title: 'Kayıp kart',
      body: 'Kartınızı hemen kapatın; yeni kart beş gün içinde gelir.',
      tags: ['kart'],
    });
    await f.create({ key: 'draft-only', title: 'İade taslağı', body: 'Henüz değil.' }, false);

    expect((await f.search('IADE')).map((hit) => hit.key)).toEqual(['refund-policy', 'draft-only']);
    // Prefix and folded words: "iadesi" and "kartı" are found by "iade" and "KARTI".
    expect((await f.search('kredi KARTI')).map((hit) => hit.key)).toEqual(['refund-policy']);
    // The title outranks the body.
    expect((await f.search('kart')).map((hit) => hit.key)).toEqual(['card-loss', 'refund-policy']);
    // No article has every word: the any-word fallback still answers.
    expect((await f.search('kart nasıl kapatılır acaba')).map((hit) => hit.key)[0]).toBe(
      'card-loss',
    );
    expect(await f.search('nasıl')).toEqual([]);
    expect((await f.search('14 gün')).at(0)?.snippet).toContain('14 gün içinde');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/knowledge-articles?q=%C4%B0ADE&status=published',
      headers: f.headers,
    });
    expect(list.json<{ data: Article[] }>().data.map((a) => a.key)).toEqual(['refund-policy']);
  });

  it('archives out of search, refuses odd transitions and audits every change', async () => {
    const f = await fixture();
    const article = await f.create({ key: 'old-offer', title: 'Eski kampanya', body: 'Bitti.' });
    const twice = await app.inject({
      method: 'POST',
      url: `/v1/knowledge-articles/${article.id}/publish`,
      headers: { ...f.auth, 'if-match': `"${String(article.version)}"` },
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json<{ code: string }>().code).toBe('VERBIS_KNOWLEDGE_INVALID_TRANSITION');
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/knowledge-articles/${article.id}`,
      headers: { ...f.headers, 'if-match': '"1"' },
      payload: { title: 'x' },
    });
    expect(stale.statusCode).toBe(412);
    const archived = await app.inject({
      method: 'POST',
      url: `/v1/knowledge-articles/${article.id}/archive`,
      headers: { ...f.auth, 'if-match': `"${String(article.version)}"` },
    });
    expect(archived.json<Article>().status).toBe('archived');
    expect(await f.search('kampanya')).toEqual([]);
    const actions = await owner.auditEvent.findMany({
      where: { tenantId: f.tenant.tenantId, targetType: 'KnowledgeArticle' },
      orderBy: { seq: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'knowledge.article.created',
      'knowledge.article.published',
      'knowledge.article.archived',
    ]);
    const outbox = await owner.outboxEvent.findMany({
      where: { tenantId: f.tenant.tenantId, aggregateType: 'KnowledgeArticle' },
    });
    expect(outbox).toHaveLength(3);
    expect(JSON.stringify(outbox.map((event) => event.payload))).not.toContain('Bitti');
  });

  it('keeps tenants apart and the key unique within a tenant', async () => {
    const a = await fixture(),
      b = await fixture();
    await a.create({ key: 'shared-key', title: 'Gizli A', body: 'Yalnız A.' });
    expect(await b.search('gizli')).toEqual([]);
    await b.create({ key: 'shared-key', title: 'B', body: 'B.' });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/knowledge-articles',
      headers: a.headers,
      payload: { key: 'shared-key', title: 'Again' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('lets the agent read published articles only through an own, live interaction session', async () => {
    const f = await fixture();
    await f.create({ key: 'refund-policy', title: 'İade politikası', body: 'İade 14 gün.' });
    await f.create({ key: 'unpublished', title: 'İade taslağı', body: 'Taslak.' }, false);
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: f.headers,
        payload: { name: 'Knowledge fixture' },
      })
    ).json<{ id: string }>();
    const version = (
      await app.inject({
        method: 'POST',
        url: `/v1/scripts/${script.id}/versions`,
        headers: f.headers,
        payload: { document: surveyScript },
      })
    ).json<{ id: string; checksum: string }>();
    const interaction = await owner.interaction.create({
      data: {
        tenantId: f.tenant.tenantId,
        externalId: `conv-${uuidv7()}`,
        channelType: 'voice',
        direction: 'inbound',
        status: 'connected',
        agentId: f.tenant.adminId,
        startedAt: new Date(),
        createdBy: 'fixture',
        updatedBy: 'fixture',
      },
    });
    const session = await owner.session.create({
      data: {
        kind: 'interaction',
        state: 'active',
        interactionId: interaction.id,
        tenantId: f.tenant.tenantId,
        userId: f.tenant.adminId,
        scriptVersionId: version.id,
        checksum: version.checksum,
        createdBy: 'fixture',
        updatedBy: 'fixture',
      },
    });
    const as = <T>(userId: string, fn: () => Promise<T>) =>
      requestContext.run(
        {
          requestId: uuidv7(),
          correlationId: uuidv7(),
          ip: '',
          userAgent: 'fixture',
          principal: {
            type: 'user',
            authMethod: 'sso',
            tenantId: f.tenant.tenantId,
            id: userId,
            sessionId: uuidv7(),
            scopes: [],
          },
          authz: {
            ability: createAbility([
              { action: ['read', 'update'], subject: 'Session', conditions: { agentId: userId } },
            ]),
            rules: [],
            roles: ['agent'],
            separationOfDuties: true,
          },
        },
        () =>
          app.get(TenantDb).run(f.tenant.tenantId, async (tx) => {
            requestContext.require().tx = tx;
            return fn();
          }),
      );
    const desktop = app.get(KnowledgeDesktopController);
    const found = await as(f.tenant.adminId, () =>
      desktop.search(session.id, { q: 'iade', limit: 10 }),
    );
    expect(found.results.map((hit) => hit.key)).toEqual(['refund-policy']);
    await expect(
      as(f.tenant.adminId, () => desktop.article(session.id, 'refund-policy')),
    ).resolves.toMatchObject({ title: 'İade politikası', body: 'İade 14 gün.' });
    await expect(
      as(f.tenant.adminId, () => desktop.article(session.id, 'unpublished')),
    ).rejects.toMatchObject({ code: 'VERBIS_RESOURCE_NOT_FOUND' });
    // Another user, even with session rights of their own, cannot use this session.
    await expect(
      as(f.tenant.designerId, () => desktop.search(session.id, { q: 'iade', limit: 10 })),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    await owner.session.update({ where: { id: session.id }, data: { state: 'completed' } });
    await expect(
      as(f.tenant.adminId, () => desktop.article(session.id, 'refund-policy')),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    // The agent's words are neither audited nor stored anywhere in SQL.
    const sql = JSON.stringify(
      await owner.auditEvent.findMany({ where: { tenantId: f.tenant.tenantId } }),
      (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    );
    expect(sql).not.toContain('"iade"');
  });
});
