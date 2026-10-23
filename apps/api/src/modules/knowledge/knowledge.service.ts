import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  type CreateKnowledgeArticleInput,
  type KnowledgeArticle,
  type KnowledgeArticleStatus,
  type KnowledgeArticleView,
  type KnowledgeSearchHit,
  type UpdateKnowledgeArticleInput,
} from '@verbis/shared-types';

import { currentActor } from '../../common/actor.js';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';

import { searchTerms, snippet, tsQuery } from './knowledge-search.js';
import {
  articleStatus,
  auditSnapshot,
  toKnowledgeArticleDto,
  toKnowledgeArticleView,
  type KnowledgeArticleListQuery,
  type KnowledgeArticleRow,
} from './knowledge.dto.js';
import { KnowledgeRepository } from './knowledge.repository.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

export const KNOWLEDGE_CLOCK = Symbol('KNOWLEDGE_CLOCK');

/** Lifecycle of an article: publish from draft or archived, archive from draft or published. */
const TRANSITIONS: Record<'publish' | 'archive', readonly KnowledgeArticleStatus[]> = {
  publish: ['draft', 'archived'],
  archive: ['draft', 'published'],
};
const TARGET: Record<'publish' | 'archive', KnowledgeArticleStatus> = {
  publish: 'published',
  archive: 'archived',
};

/**
 * In-script knowledge base (ADR-0057): tenant articles, their lifecycle and search. Every change
 * is audited with its before/after in the request transaction and published through the outbox
 * with metadata only. Search text is never stored, logged or audited.
 */
@Injectable()
export class KnowledgeService {
  private readonly repository = new KnowledgeRepository();
  readonly #now: () => Date;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Optional() @Inject(KNOWLEDGE_CLOCK) now?: () => Date,
  ) {
    this.#now = now ?? (() => new Date());
  }

  async list(query: KnowledgeArticleListQuery): Promise<Page<KnowledgeArticle>> {
    const rows = await this.repository.list(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toKnowledgeArticleDto, (row, field) => row[field]);
  }

  async get(id: string): Promise<KnowledgeArticle> {
    return toKnowledgeArticleDto(await this.require(id));
  }

  /** Any non-archived article by key, for authors (the designer preview and pickers). */
  async byKey(key: string): Promise<KnowledgeArticle> {
    const row = await this.repository.findByKey(this.db.current(), this.db.tenantId(), key);
    if (row === null || row.status === 'archived') throw new NotFoundError('KnowledgeArticle');
    return toKnowledgeArticleDto(row);
  }

  /** A published article as an agent reads it. */
  async published(key: string): Promise<KnowledgeArticleView> {
    const row = await this.repository.findByKey(
      this.db.current(),
      this.db.tenantId(),
      key,
      'published',
    );
    if (row === null) throw new NotFoundError('KnowledgeArticle');
    return toKnowledgeArticleView(row);
  }

  /** Ranked search: every word first, then any meaningful word. */
  async search(
    q: string,
    options: { readonly publishedOnly: boolean; readonly limit: number },
  ): Promise<KnowledgeSearchHit[]> {
    const terms = searchTerms(q);
    const rows = await this.find(this.db.current(), this.db.tenantId(), terms, options);
    return rows.map((row) => ({
      key: row.key,
      title: row.title,
      snippet: snippet(row.body, terms),
      tags: row.tags,
      locale: row.locale,
      status: articleStatus(row),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** Published articles that best match a question (the AI `answer` task's sources). */
  retrieve(
    tx: TransactionClient,
    tenantId: string,
    question: string,
    limit: number,
  ): Promise<KnowledgeArticleRow[]> {
    return this.find(tx, tenantId, searchTerms(question), { publishedOnly: true, limit });
  }

  async create(input: CreateKnowledgeArticleInput): Promise<KnowledgeArticle> {
    const tx = this.db.current();
    if ((await this.repository.findByKey(tx, this.db.tenantId(), input.key)) !== null)
      throw new ConflictError('An article with this key already exists');
    const row = await this.repository.create(tx, this.db.tenantId(), input, currentActor());
    await this.record(tx, 'created', row, null);
    return toKnowledgeArticleDto(row);
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateKnowledgeArticleInput,
  ): Promise<KnowledgeArticle> {
    const tx = this.db.current();
    const before = await this.requireVersion(id, expectedVersion);
    const row = await this.repository.update(
      tx,
      this.db.tenantId(),
      id,
      expectedVersion,
      {
        title: input.title ?? before.title,
        body: input.body ?? before.body,
        tags: input.tags ?? before.tags,
        locale: input.locale ?? before.locale,
      },
      currentActor(),
    );
    if (row === null) throw new VersionMismatchError();
    await this.record(tx, 'updated', row, before);
    return toKnowledgeArticleDto(row);
  }

  async transition(
    id: string,
    expectedVersion: number,
    action: 'publish' | 'archive',
  ): Promise<KnowledgeArticle> {
    const tx = this.db.current();
    const before = await this.requireVersion(id, expectedVersion);
    const from = articleStatus(before);
    if (!TRANSITIONS[action].includes(from))
      throw new DomainError(
        'VERBIS_KNOWLEDGE_INVALID_TRANSITION',
        `A ${from} article cannot be ${action === 'publish' ? 'published' : 'archived'}`,
      );
    const row = await this.repository.transition(
      tx,
      this.db.tenantId(),
      id,
      { version: expectedVersion, status: from },
      TARGET[action],
      currentActor(),
      this.#now(),
    );
    if (row === null) throw new VersionMismatchError();
    await this.record(tx, action === 'publish' ? 'published' : 'archived', row, before);
    return toKnowledgeArticleDto(row);
  }

  private async find(
    tx: TransactionClient,
    tenantId: string,
    terms: readonly string[],
    options: { readonly publishedOnly: boolean; readonly limit: number },
  ): Promise<KnowledgeArticleRow[]> {
    const all = tsQuery(terms, 'all');
    if (all !== null) {
      const rows = await this.repository.search(tx, tenantId, all, options);
      if (rows.length > 0) return rows;
    }
    const any = tsQuery(terms, 'any');
    return any === null || any === all ? [] : this.repository.search(tx, tenantId, any, options);
  }

  private async record(
    tx: TransactionClient,
    verb: 'created' | 'updated' | 'published' | 'archived',
    row: KnowledgeArticleRow,
    before: KnowledgeArticleRow | null,
  ): Promise<void> {
    await this.audit.record(tx, {
      action: `knowledge.article.${verb}`,
      target: { type: 'KnowledgeArticle', id: row.id, name: row.key },
      before: before === null ? null : auditSnapshot(before),
      after: auditSnapshot(row),
    });
    await this.outbox.record(tx, {
      type: `verbis.knowledge.article.${verb}.v1`,
      aggregateType: 'KnowledgeArticle',
      aggregateId: row.id,
      payload: {
        article: {
          id: row.id,
          key: row.key,
          status: articleStatus(row),
          locale: row.locale,
          version: row.version,
        },
      },
    });
  }

  private async require(id: string): Promise<KnowledgeArticleRow> {
    const row = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('KnowledgeArticle');
    return row;
  }

  private async requireVersion(id: string, expectedVersion: number): Promise<KnowledgeArticleRow> {
    const current = await this.require(id);
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    return current;
  }
}
