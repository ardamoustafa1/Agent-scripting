import { z } from 'zod';

import {
  KnowledgeArticleSchema,
  KnowledgeArticleStatusSchema,
  type KnowledgeArticle,
  type KnowledgeArticleStatus,
  type KnowledgeArticleView,
} from '@verbis/shared-types';

import { iso, isoOrNull } from '../../common/dto.js';
import { listQuerySchema, pageSchema } from '../../common/pagination/pagination.js';

export const KnowledgeArticleListQuerySchema = listQuerySchema(['updatedAt', 'title'], {
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({ description: 'Title, key or tag contains (Turkish-insensitive)' }),
  status: KnowledgeArticleStatusSchema.optional(),
});
export type KnowledgeArticleListQuery = z.output<typeof KnowledgeArticleListQuerySchema>;
export const KnowledgeArticlePageSchema = pageSchema(KnowledgeArticleSchema).meta({
  id: 'KnowledgeArticlePage',
});

export interface KnowledgeArticleRow {
  id: string;
  key: string;
  title: string;
  body: string;
  tags: string[];
  locale: string;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  version: number;
}

export function articleStatus(row: Pick<KnowledgeArticleRow, 'status'>): KnowledgeArticleStatus {
  return KnowledgeArticleStatusSchema.parse(row.status);
}

export function toKnowledgeArticleDto(row: KnowledgeArticleRow): KnowledgeArticle {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    body: row.body,
    tags: row.tags,
    locale: row.locale,
    status: articleStatus(row),
    publishedAt: isoOrNull(row.publishedAt),
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: iso(row.updatedAt),
    updatedBy: row.updatedBy,
    version: row.version,
  };
}

export function toKnowledgeArticleView(row: KnowledgeArticleRow): KnowledgeArticleView {
  return {
    key: row.key,
    title: row.title,
    body: row.body,
    tags: row.tags,
    locale: row.locale,
    updatedAt: iso(row.updatedAt),
  };
}

/** Audit snapshot: the body is tenant reference content, never customer data. */
export function auditSnapshot(row: KnowledgeArticleRow) {
  const { id, key, title, body, tags, locale, status, version } = toKnowledgeArticleDto(row);
  return { id, key, title, body, tags, locale, status, version };
}
