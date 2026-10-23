import { describe, expect, it, vi } from 'vitest';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import {
  ConflictError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';

import { KnowledgeArticleListQuerySchema } from './knowledge.dto.js';
import { KnowledgeService } from './knowledge.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import type { AuditService } from '../audit/audit.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const ID = '0199a000-0000-7000-8000-0000000000cc';
const NOW = new Date('2026-10-22T10:00:00.000Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  key: 'refund-policy',
  title: 'İade politikası',
  body: 'İade 14 gün içinde yapılır.',
  tags: ['iade'],
  locale: 'tr',
  status: 'draft',
  publishedAt: null,
  createdAt: NOW,
  createdBy: 'user:u-1',
  updatedAt: NOW,
  updatedBy: 'user:u-1',
  version: 1,
  ...over,
});

function setup(existing: Record<string, unknown> | null = row(), after = existing) {
  const tx = {
    knowledgeArticle: {
      findFirst: vi
        .fn((_args: unknown) => Promise.resolve(existing))
        .mockResolvedValueOnce(existing)
        .mockResolvedValue(after),
      findMany: vi.fn((_args: unknown) => Promise.resolve([row()])),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(row({ ...args.data })),
      ),
      updateMany: vi.fn((_args: unknown) => Promise.resolve({ count: 1 })),
    },
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([] as { id: string }[]),
    ),
  };
  const audit = { record: vi.fn(() => Promise.resolve({})) };
  const outbox = { record: vi.fn(() => Promise.resolve()) };
  const service = new KnowledgeService(
    { current: () => tx, tenantId: () => TENANT } as unknown as TenantDb,
    audit as unknown as AuditService,
    outbox as unknown as OutboxWriter,
    () => NOW,
  );
  const ctx = {
    requestId: 'r',
    correlationId: 'c',
    ip: '',
    userAgent: '',
    principal: { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [] },
  } as unknown as RequestContext;
  const run = <T>(fn: () => T): T => requestContext.run(ctx, fn);
  return { tx, audit, outbox, service, run };
}

describe('knowledge articles (ADR-0057)', () => {
  it('creates a draft with folded search columns, audit and a metadata-only outbox event', async () => {
    const { tx, audit, outbox, service, run } = setup(null);
    const dto = await run(() =>
      service.create({
        key: 'card-loss',
        title: 'Kayıp KART',
        body: '## Adımlar\n- Kartı kapat',
        tags: ['Kart'],
        locale: 'tr',
      }),
    );
    expect(tx.knowledgeArticle.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        tenantId: TENANT,
        key: 'card-loss',
        searchTitle: 'kayip kart',
        searchTags: 'kart',
        searchBody: 'adimlar karti kapat',
        createdBy: 'user:u-1',
      },
    });
    expect(dto.status).toBe('draft');
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'knowledge.article.created',
        target: { type: 'KnowledgeArticle', id: ID, name: 'card-loss' },
        before: null,
      }),
    );
    expect(outbox.record).toHaveBeenCalledWith(tx, {
      type: 'verbis.knowledge.article.created.v1',
      aggregateType: 'KnowledgeArticle',
      aggregateId: ID,
      payload: {
        article: { id: ID, key: 'card-loss', status: 'draft', locale: 'tr', version: 1 },
      },
    });
    expect(JSON.stringify(outbox.record.mock.calls)).not.toContain('Kartı kapat');
  });

  it('refuses a key that is already taken', async () => {
    const { service, run, audit } = setup(row());
    await expect(
      run(() =>
        service.create({ key: 'refund-policy', title: 'x', body: '', tags: [], locale: 'tr' }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('edits with optimistic locking and refreshes the search columns', async () => {
    const { tx, audit, service, run } = setup(row(), row({ title: 'Yeni', version: 2 }));
    const dto = await run(() => service.update(ID, 1, { title: 'Yeni' }));
    expect(tx.knowledgeArticle.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ID, tenantId: TENANT, deletedAt: null, version: 1 },
      data: { title: 'Yeni', body: 'İade 14 gün içinde yapılır.', searchTitle: 'yeni' },
    });
    expect(dto.version).toBe(2);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'knowledge.article.updated',
        before: expect.objectContaining({ title: 'İade politikası' }) as unknown,
        after: expect.objectContaining({ title: 'Yeni' }) as unknown,
      }),
    );
  });

  it('reports a stale version and a missing article', async () => {
    await expect(
      setup(row({ version: 3 })).run(() =>
        setup(row({ version: 3 })).service.update(ID, 1, { title: 'x' }),
      ),
    ).rejects.toBeInstanceOf(VersionMismatchError);
    const missing = setup(null);
    await expect(missing.run(() => missing.service.get(ID))).rejects.toBeInstanceOf(NotFoundError);
    const raced = setup(row());
    raced.tx.knowledgeArticle.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      raced.run(() => raced.service.update(ID, 1, { title: 'x' })),
    ).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it('publishes a draft with the injected clock and archives a published article', async () => {
    const draft = setup(row(), row({ status: 'published', publishedAt: NOW, version: 2 }));
    const published = await draft.run(() => draft.service.transition(ID, 1, 'publish'));
    expect(draft.tx.knowledgeArticle.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ID, version: 1, status: 'draft' },
      data: { status: 'published', publishedAt: NOW },
    });
    expect(published.status).toBe('published');
    expect(draft.audit.record).toHaveBeenCalledWith(
      draft.tx,
      expect.objectContaining({ action: 'knowledge.article.published' }),
    );
    const live = setup(row({ status: 'published' }), row({ status: 'archived', version: 2 }));
    await live.run(() => live.service.transition(ID, 1, 'archive'));
    expect(live.outbox.record).toHaveBeenCalledWith(
      live.tx,
      expect.objectContaining({ type: 'verbis.knowledge.article.archived.v1' }),
    );
  });

  it('refuses transitions the lifecycle does not have', async () => {
    for (const [status, action] of [
      ['published', 'publish'],
      ['archived', 'archive'],
    ] as const) {
      const f = setup(row({ status }));
      await expect(f.run(() => f.service.transition(ID, 1, action))).rejects.toMatchObject({
        code: 'VERBIS_KNOWLEDGE_INVALID_TRANSITION',
      });
      expect(f.tx.knowledgeArticle.updateMany).not.toHaveBeenCalled();
    }
  });

  it('shows agents published articles only, and authors anything but archived ones', async () => {
    const agent = setup(null);
    await expect(agent.run(() => agent.service.published('refund-policy'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(agent.tx.knowledgeArticle.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { key: 'refund-policy', status: 'published', tenantId: TENANT },
    });
    const archived = setup(row({ status: 'archived' }));
    await expect(
      archived.run(() => archived.service.byKey('refund-policy')),
    ).rejects.toBeInstanceOf(NotFoundError);
    const view = setup(row({ status: 'published' }));
    expect(await view.run(() => view.service.published('refund-policy'))).toEqual({
      key: 'refund-policy',
      title: 'İade politikası',
      body: 'İade 14 gün içinde yapılır.',
      tags: ['iade'],
      locale: 'tr',
      updatedAt: NOW.toISOString(),
    });
  });

  it('searches every word first, then any meaningful word, never with raw user text', async () => {
    const f = setup(row({ status: 'published' }));
    f.tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: ID }]);
    f.tx.knowledgeArticle.findMany.mockResolvedValue([row({ status: 'published' })]);
    const hits = await f.run(() =>
      f.service.search("İade nasıl'; DROP TABLE x", { publishedOnly: true, limit: 5 }),
    );
    const values = f.tx.$queryRaw.mock.calls.map((call) => call.slice(1));
    expect(values[0]).toContain('iade:* & nasil:* & drop:* & table:* & x');
    expect(values[1]).toContain('iade:* | drop:* | table:* | x');
    const texts = values.flat().filter((value): value is string => typeof value === 'string');
    expect(texts.some((text) => text.includes("'"))).toBe(false);
    expect(hits).toEqual([
      expect.objectContaining({ key: 'refund-policy', snippet: 'İade 14 gün içinde yapılır.' }),
    ]);
    const nothing = setup(null);
    expect(
      await nothing.run(() => nothing.service.search('?!', { publishedOnly: true, limit: 5 })),
    ).toEqual([]);
    expect(nothing.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('filters the author list by folded title, tag or key and by state', async () => {
    const f = setup();
    await f.run(() =>
      f.service.list(KnowledgeArticleListQuerySchema.parse({ q: 'İADE Pol', status: 'draft' })),
    );
    expect(f.tx.knowledgeArticle.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        status: 'draft',
        OR: [
          { searchTitle: { contains: 'iade pol' } },
          { searchTags: { contains: 'iade pol' } },
          { key: { contains: 'iade-pol' } },
        ],
      },
    });
  });
});
