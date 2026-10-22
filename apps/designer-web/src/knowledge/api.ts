import { z } from 'zod';

import { type ComponentEnvironment, type KnowledgePort } from '@verbis/components';
import { textWords } from '@verbis/script-schema';
import {
  KNOWLEDGE_LIMITS,
  KnowledgeArticleSchema,
  KnowledgeSearchResultSchema,
  type KnowledgeArticle,
} from '@verbis/shared-types';

import { ApiError, request, type Session } from '../api/client.js';

/** Query key of everything knowledge-related, partitioned like the rest of the workspace. */
export function knowledgeKey(session: Session, ...rest: unknown[]): unknown[] {
  return [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'knowledge',
    ...rest,
  ];
}

export const ArticlePageSchema = z.object({
  data: z.array(KnowledgeArticleSchema),
  page: z.object({ nextCursor: z.string().nullable() }),
});

/** A draft or published article by key; null when there is none (or it is archived). */
export async function articleByKey(
  key: string,
  signal?: AbortSignal,
): Promise<KnowledgeArticle | null> {
  try {
    return await request(
      `/v1/knowledge-articles/by-key/${encodeURIComponent(key)}`,
      KnowledgeArticleSchema,
      signal ? { signal } : {},
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function searchArticles(query: string, signal?: AbortSignal) {
  return (
    await request(
      `/v1/knowledge-articles/search?${new URLSearchParams({ q: query, limit: '10' }).toString()}`,
      KnowledgeSearchResultSchema,
      signal ? { signal } : {},
    )
  ).results;
}

/**
 * The preview's knowledge base: published articles only, exactly what an agent would see.
 * Drafts are checked on the article's own page.
 */
export const previewKnowledge: KnowledgePort = {
  article: async (key, signal) => {
    const article = await articleByKey(key, signal);
    return article?.status === 'published'
      ? { key: article.key, title: article.title, body: article.body }
      : null;
  },
  search: async (query, signal) =>
    (await searchArticles(query, signal)).filter((hit) => hit.status === 'published'),
};

/** Component environment of the canvas and preview: the defaults plus the knowledge base. */
export const previewEnvironment: ComponentEnvironment = {
  mediaOrigins: [],
  frameOrigins: [],
  knowledgeOrigins: [],
  features: [],
  now: Date.now,
  knowledge: previewKnowledge,
};

/** A key proposed from a title: folded words joined by dashes ("İade Politikası" → "iade-politikasi"). */
export function keyFromTitle(title: string): string {
  const words = textWords(title)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  let key = '';
  for (const word of words) {
    const next = key === '' ? word : `${key}-${word}`;
    if (next.length > KNOWLEDGE_LIMITS.maxKey) break;
    key = next;
  }
  if (key === '' || /^[a-z]/.test(key)) return key;
  return `article-${key}`.slice(0, KNOWLEDGE_LIMITS.maxKey).replace(/-+$/, '');
}

/** Comma- or line-separated tags, trimmed and without repeats. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((tag) => tag.trim().slice(0, KNOWLEDGE_LIMITS.maxTag))
        .filter(Boolean),
    ),
  ].slice(0, KNOWLEDGE_LIMITS.maxTags);
}
