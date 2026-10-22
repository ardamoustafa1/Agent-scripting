import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { RendererProps } from '@verbis/core-runtime';
import { I18nKeySchema, KnowledgeArticleKeySchema } from '@verbis/script-schema';
import { Accordion, Alert, ArticleBody, Button, Input } from '@verbis/ui';

import {
  useComponentEnvironment,
  type KnowledgeArticleContent,
  type KnowledgeHit,
  type KnowledgePort,
} from './environment.js';
import { Frame, useLabels } from './shared.js';

/** Pinned articles per panel (ADR-0057). */
export const KNOWLEDGE_PANEL_MAX_ARTICLES = 10;
export const KnowledgePanelSchema = z.strictObject({
  labelKey: I18nKeySchema.default('components.knowledge.title'),
  descriptionKey: I18nKeySchema.optional(),
  /** Keys of tenant knowledge articles shown on this page, read in place. */
  articles: z.array(KnowledgeArticleKeySchema).max(KNOWLEDGE_PANEL_MAX_ARTICLES).default([]),
  /** Lets the agent search the whole knowledge base from the page. */
  searchable: z.boolean().default(true),
  disabled: z.boolean().default(false),
});

/** Waits this long after typing stops before searching. */
export const KNOWLEDGE_SEARCH_DELAY_MS = 300;

type Pinned = { key: string; article: KnowledgeArticleContent | null }[];

/**
 * In-script knowledge (ADR-0057): the articles the author pinned to this page, read without
 * leaving it, and a search over the published knowledge base. Content comes from the host's
 * knowledge port at render time; the script carries keys only.
 */
export function KnowledgeComponent(component: RendererProps) {
  const p = KnowledgePanelSchema.parse(component.props),
    { text, t } = useLabels(component),
    { knowledge } = useComponentEnvironment(),
    heading = useId();
  const keys = p.articles.join(' ');
  // Results belong to the keys they were loaded for, so a changed list never shows stale ones.
  const [loaded, setLoaded] = useState<{ keys: string; pinned: Pinned | null } | null>(null);
  const pinned = loaded?.keys === keys ? loaded.pinned : null,
    failed = loaded?.keys === keys && loaded.pinned === null;
  useEffect(() => {
    if (!knowledge) return undefined;
    const controller = new AbortController();
    Promise.all(
      keys
        .split(' ')
        .filter(Boolean)
        .map(async (key) => ({ key, article: await knowledge.article(key, controller.signal) })),
    )
      .then((articles) => {
        if (!controller.signal.aborted) setLoaded({ keys, pinned: articles });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ keys, pinned: null });
      });
    return () => {
      controller.abort();
    };
  }, [knowledge, keys]);
  return (
    <Frame component={component}>
      <section className="vc-knowledge" aria-labelledby={heading}>
        <h3 id={heading} className="vc-knowledge-title">
          {text(p.labelKey)}
        </h3>
        {p.descriptionKey && <p className="vc-knowledge-muted">{text(p.descriptionKey)}</p>}
        {!knowledge ? (
          <Alert title={t('components.knowledge.unavailable')} />
        ) : (
          <>
            {failed && <Alert tone="warning" title={t('components.knowledge.loadFailed')} />}
            {pinned !== null && pinned.some((entry) => entry.article !== null) && (
              <Accordion
                items={pinned.flatMap(({ key, article }) =>
                  article === null
                    ? []
                    : [
                        {
                          value: key,
                          title: article.title,
                          content: <ArticleBody body={article.body} headingLevel={4} />,
                        },
                      ],
                )}
              />
            )}
            {pinned !== null && pinned.some((entry) => entry.article === null) && (
              <p className="vc-knowledge-muted">
                {t('components.knowledge.missing', {
                  count: pinned.filter((entry) => entry.article === null).length,
                })}
              </p>
            )}
            {p.searchable && <KnowledgeSearch knowledge={knowledge} disabled={p.disabled} />}
          </>
        )}
      </section>
    </Frame>
  );
}

function KnowledgeSearch({ knowledge, disabled }: { knowledge: KnowledgePort; disabled: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''),
    [submitted, setSubmitted] = useState(''),
    [found, setFound] = useState<{
      query: string;
      hits: readonly KnowledgeHit[] | null;
    } | null>(null),
    [open, setOpen] = useState<KnowledgeArticleContent | null>(null),
    [readFailed, setReadFailed] = useState(false);
  const current = submitted !== '' && found?.query === submitted ? found : null,
    hits = current?.hits ?? null,
    loading = submitted !== '' && current === null,
    failed = readFailed || (current !== null && current.hits === null);
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      setSubmitted(trimmed);
    }, KNOWLEDGE_SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    if (submitted === '') return undefined;
    const controller = new AbortController();
    knowledge
      .search(submitted, controller.signal)
      .then((results) => {
        if (!controller.signal.aborted) setFound({ query: submitted, hits: results });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFound({ query: submitted, hits: null });
      });
    return () => {
      controller.abort();
    };
  }, [knowledge, submitted]);
  const read = (key: string) => {
    const controller = new AbortController();
    void knowledge
      .article(key, controller.signal)
      .then((article) => {
        setReadFailed(article === null);
        setOpen(article);
      })
      .catch(() => {
        setReadFailed(true);
      });
  };
  // Enter searches at once; it must not reach the desktop's "next step" shortcut.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    setSubmitted(query.trim());
  };
  if (open)
    return (
      <article className="vc-knowledge-reader" aria-label={open.title}>
        <h4>{open.title}</h4>
        <ArticleBody body={open.body} headingLevel={5} />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(null);
          }}
        >
          {t('components.knowledge.back')}
        </Button>
      </article>
    );
  return (
    <div className="vc-knowledge-search">
      <Input
        type="search"
        label={t('components.knowledge.search')}
        value={query}
        maxLength={200}
        disabled={disabled}
        autoComplete="off"
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <p className="vb-sr-only" role="status">
        {hits === null
          ? ''
          : hits.length === 0
            ? t('components.knowledge.none')
            : t('components.knowledge.results', { count: hits.length })}
      </p>
      {loading && <p className="vc-knowledge-muted">{t('components.knowledge.searching')}</p>}
      {failed && <Alert tone="warning" title={t('components.knowledge.loadFailed')} />}
      {hits !== null && hits.length === 0 && (
        <p className="vc-knowledge-muted">{t('components.knowledge.none')}</p>
      )}
      {hits !== null && hits.length > 0 && (
        <ul className="vc-knowledge-results">
          {hits.map((hit) => (
            <li key={hit.key}>
              <button
                type="button"
                className="vc-knowledge-hit"
                onClick={() => {
                  read(hit.key);
                }}
              >
                <strong>{hit.title}</strong> <span>{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
