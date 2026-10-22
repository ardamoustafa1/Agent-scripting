import { Injectable } from '@nestjs/common';

import { foldText, textWords } from '@verbis/script-schema';
import { type KnowledgeArticleStatus } from '@verbis/shared-types';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';

import { searchColumns } from './knowledge-search.js';

import type { KnowledgeArticleListQuery, KnowledgeArticleRow } from './knowledge.dto.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const SELECT = {
  id: true,
  key: true,
  title: true,
  body: true,
  tags: true,
  locale: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
  version: true,
} satisfies Prisma.KnowledgeArticleSelect;

export interface ArticleContent {
  title: string;
  body: string;
  tags: string[];
  locale: string;
}

/** Every query filters by tenant and runs inside the tenant transaction (RLS). */
@Injectable()
export class KnowledgeRepository {
  list(
    tx: TransactionClient,
    tenantId: string,
    query: KnowledgeArticleListQuery,
  ): Promise<KnowledgeArticleRow[]> {
    const { q, status } = query.filters;
    const folded = q === undefined ? '' : textWords(q).join(' ');
    const where: Prisma.KnowledgeArticleWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status === undefined ? {} : { status }),
      ...(q === undefined
        ? {}
        : {
            OR: [
              { searchTitle: { contains: folded } },
              { searchTags: { contains: folded } },
              { key: { contains: foldText(q).replace(/\s+/g, '-') } },
            ],
          }),
    };
    const after = keysetWhere(query) as Prisma.KnowledgeArticleWhereInput | undefined;
    return tx.knowledgeArticle.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SELECT,
    });
  }

  find(tx: TransactionClient, tenantId: string, id: string): Promise<KnowledgeArticleRow | null> {
    return tx.knowledgeArticle.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: SELECT,
    });
  }

  findByKey(
    tx: TransactionClient,
    tenantId: string,
    key: string,
    status?: KnowledgeArticleStatus,
  ): Promise<KnowledgeArticleRow | null> {
    return tx.knowledgeArticle.findFirst({
      where: { key, tenantId, deletedAt: null, ...(status === undefined ? {} : { status }) },
      select: SELECT,
    });
  }

  /**
   * Ranked full-text search over the generated index. `query` is built by `tsQuery` from folded
   * words only. Archived articles never match; `published` limits it to what agents may read.
   */
  async search(
    tx: TransactionClient,
    tenantId: string,
    query: string,
    options: { readonly publishedOnly: boolean; readonly limit: number },
  ): Promise<KnowledgeArticleRow[]> {
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM knowledge_articles
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
         AND ${options.publishedOnly ? Prisma.sql`status = 'published'` : Prisma.sql`status <> 'archived'`}
         AND search @@ to_tsquery('simple', ${query})
       ORDER BY ts_rank_cd(search, to_tsquery('simple', ${query})) DESC, updated_at DESC, id
       LIMIT ${options.limit}`;
    if (ids.length === 0) return [];
    const rows = await tx.knowledgeArticle.findMany({
      where: { tenantId, id: { in: ids.map((row) => row.id) } },
      select: SELECT,
    });
    const order = new Map(ids.map((row, index) => [row.id, index]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  create(
    tx: TransactionClient,
    tenantId: string,
    input: ArticleContent & { key: string },
    actor: string,
  ): Promise<KnowledgeArticleRow> {
    return tx.knowledgeArticle.create({
      data: {
        tenantId,
        key: input.key,
        title: input.title,
        body: input.body,
        tags: input.tags,
        locale: input.locale,
        ...searchColumns(input),
        createdBy: actor,
        updatedBy: actor,
      },
      select: SELECT,
    });
  }

  async update(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    content: ArticleContent,
    actor: string,
  ): Promise<KnowledgeArticleRow | null> {
    const result = await tx.knowledgeArticle.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data: { ...content, ...searchColumns(content), updatedBy: actor, version: { increment: 1 } },
    });
    return result.count === 0 ? null : this.find(tx, tenantId, id);
  }

  /** State-guarded transition: fails when the version or the state moved meanwhile. */
  async transition(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expected: { readonly version: number; readonly status: KnowledgeArticleStatus },
    to: KnowledgeArticleStatus,
    actor: string,
    now: Date,
  ): Promise<KnowledgeArticleRow | null> {
    const result = await tx.knowledgeArticle.updateMany({
      where: { id, tenantId, deletedAt: null, version: expected.version, status: expected.status },
      data: {
        status: to,
        ...(to === 'published' ? { publishedAt: now } : {}),
        updatedBy: actor,
        version: { increment: 1 },
      },
    });
    return result.count === 0 ? null : this.find(tx, tenantId, id);
  }
}
