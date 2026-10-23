import { z } from 'zod';

/**
 * In-script knowledge base (ADR-0057): tenant articles agents search and read next to the script.
 * Scripts reference an article by its stable `key`, as they reference data sources.
 */
export const KNOWLEDGE_LIMITS = {
  maxKey: 64,
  maxTitle: 160,
  maxBody: 20_000,
  maxTags: 10,
  maxTag: 40,
  maxQuery: 200,
  maxQuestion: 500,
  maxResults: 20,
} as const;

/** Same rule as the script model's `KnowledgeArticleKeySchema` (`@verbis/script-schema`). */
export const KnowledgeArticleKeySchema = z
  .string()
  .min(1)
  .max(KNOWLEDGE_LIMITS.maxKey)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'Article keys must be kebab-case (e.g. "refund-policy")');

export const KnowledgeArticleStatusSchema = z.enum(['draft', 'published', 'archived']);
export type KnowledgeArticleStatus = z.infer<typeof KnowledgeArticleStatusSchema>;

const TitleSchema = z.string().trim().min(1).max(KNOWLEDGE_LIMITS.maxTitle);
const BodySchema = z.string().max(KNOWLEDGE_LIMITS.maxBody);
const TagSchema = z.string().trim().min(1).max(KNOWLEDGE_LIMITS.maxTag);
const TagsSchema = z
  .array(TagSchema)
  .max(KNOWLEDGE_LIMITS.maxTags)
  .transform((tags) => [...new Set(tags)]);
const LocaleSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(-[A-Z][a-zA-Z0-9]{1,7})?$/,
    'Expected a BCP 47 locale such as "tr" or "en-GB"',
  );

/** An article as its authors see it (every state). */
export const KnowledgeArticleSchema = z
  .object({
    id: z.uuid(),
    key: KnowledgeArticleKeySchema,
    title: TitleSchema,
    body: BodySchema,
    tags: z.array(z.string()),
    locale: LocaleSchema,
    status: KnowledgeArticleStatusSchema,
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    updatedBy: z.string(),
    version: z.number().int().positive(),
  })
  .meta({ id: 'KnowledgeArticle' });
export type KnowledgeArticle = z.infer<typeof KnowledgeArticleSchema>;

export const CreateKnowledgeArticleSchema = z
  .strictObject({
    key: KnowledgeArticleKeySchema,
    title: TitleSchema,
    body: BodySchema.default(''),
    tags: TagsSchema.default([]),
    locale: LocaleSchema.default('tr'),
  })
  .meta({ id: 'CreateKnowledgeArticle' });
export type CreateKnowledgeArticleInput = z.output<typeof CreateKnowledgeArticleSchema>;

/** The key is immutable; the state changes only through publish and archive. */
export const UpdateKnowledgeArticleSchema = z
  .strictObject({
    title: TitleSchema.optional(),
    body: BodySchema.optional(),
    tags: TagsSchema.optional(),
    locale: LocaleSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nothing to update')
  .meta({ id: 'UpdateKnowledgeArticle' });
export type UpdateKnowledgeArticleInput = z.output<typeof UpdateKnowledgeArticleSchema>;

/** A published article as an agent reads it. */
export const KnowledgeArticleViewSchema = z
  .object({
    key: KnowledgeArticleKeySchema,
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    locale: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'KnowledgeArticleView' });
export type KnowledgeArticleView = z.infer<typeof KnowledgeArticleViewSchema>;

export const KnowledgeSearchHitSchema = z
  .object({
    key: KnowledgeArticleKeySchema,
    title: z.string(),
    /** A short plain-text excerpt around the first matching word. */
    snippet: z.string(),
    tags: z.array(z.string()),
    locale: z.string(),
    status: KnowledgeArticleStatusSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'KnowledgeSearchHit' });
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHitSchema>;

export const KnowledgeSearchResultSchema = z
  .object({ results: z.array(KnowledgeSearchHitSchema) })
  .meta({ id: 'KnowledgeSearchResult' });
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;

export const KnowledgeSearchQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1).max(KNOWLEDGE_LIMITS.maxQuery),
    limit: z.coerce.number().int().min(1).max(KNOWLEDGE_LIMITS.maxResults).default(10),
  })
  .meta({ id: 'KnowledgeSearchQuery' });
export type KnowledgeSearchQuery = z.output<typeof KnowledgeSearchQuerySchema>;

/** Output of the AI `answer` task: an answer only from the cited articles, or none. */
export const KnowledgeAnswerSchema = z.looseObject({
  answer: z.string().nullable(),
  articleKeys: z.array(KnowledgeArticleKeySchema),
});
export type KnowledgeAnswer = z.infer<typeof KnowledgeAnswerSchema>;

export type ArticleBlock =
  | { readonly type: 'paragraph'; readonly lines: readonly string[] }
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] };

const ORDERED = /^\d{1,3}[.)]\s+/;
const BULLET = /^[-*]\s+/;

/**
 * The article body format: a blank line starts a paragraph, `## ` a subheading, `- ` (or `* `)
 * and `1. ` list items. The result is rendered as elements, never as HTML (SECURITY §5.2).
 */
export function parseArticleBody(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  let open:
    | { type: 'paragraph'; lines: string[] }
    | {
        type: 'list';
        ordered: boolean;
        items: string[];
      }
    | null = null;
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^##(\s|$)/.test(line);
    const ordered = ORDERED.test(line);
    const item = ordered || BULLET.test(line);
    const continues =
      open !== null &&
      line !== '' &&
      !heading &&
      (open.type === 'list' ? item && open.ordered === ordered : !item);
    if (open !== null && !continues) {
      blocks.push(open);
      open = null;
    }
    if (line === '') continue;
    if (heading) {
      const text = line.slice(2).trim();
      if (text !== '') blocks.push({ type: 'heading', text });
    } else if (item) {
      const text = line.replace(ordered ? ORDERED : BULLET, '');
      if (open?.type === 'list') open.items.push(text);
      else open = { type: 'list', ordered, items: [text] };
    } else if (open?.type === 'paragraph') open.lines.push(line);
    else open = { type: 'paragraph', lines: [line] };
  }
  if (open !== null) blocks.push(open);
  return blocks;
}

/** Plain text of a body without its markers, e.g. for snippets and model input. */
export function articlePlainText(body: string): string {
  return parseArticleBody(body)
    .map((block) =>
      block.type === 'heading'
        ? block.text
        : block.type === 'list'
          ? block.items.join('\n')
          : block.lines.join('\n'),
    )
    .join('\n\n');
}
