import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { type KnowledgePort } from '@verbis/components';
import {
  AiSuggestionSchema,
  KnowledgeAnswerSchema,
  KnowledgeArticleViewSchema,
  KnowledgeSearchResultSchema,
  type KnowledgeArticleView,
} from '@verbis/shared-types';
import { Alert, ArticleBody, Button, Input } from '@verbis/ui';

import { AgentError, api } from './api.js';

/** Waits this long after typing stops before searching. */
export const SEARCH_DELAY_MS = 300;

export interface DesktopKnowledge extends KnowledgePort {
  article: (key: string, signal: AbortSignal) => Promise<KnowledgeArticleView | null>;
}

/**
 * Published knowledge articles read through the agent's own session (ADR-0057). Search goes in
 * a POST body so the agent's words never sit in a URL.
 */
export function desktopKnowledge(sessionId: string, csrf: string): DesktopKnowledge {
  return {
    article: async (key, signal) => {
      try {
        return await api(
          `/v1/sessions/${sessionId}/desktop/knowledge/${encodeURIComponent(key)}`,
          KnowledgeArticleViewSchema,
          undefined,
          undefined,
          signal,
        );
      } catch (error) {
        if (error instanceof AgentError && error.status === 404) return null;
        throw error;
      }
    },
    search: async (query, signal) =>
      (
        await api(
          `/v1/sessions/${sessionId}/desktop/knowledge/search`,
          KnowledgeSearchResultSchema,
          csrf,
          { q: query, limit: 10 },
          signal,
        )
      ).results,
  };
}

/** What the knowledge tab keeps while the agent switches tabs. */
export interface KnowledgeState {
  query: string;
  open: string | null;
  answer: Answer | null;
}
export const EMPTY_KNOWLEDGE: KnowledgeState = { query: '', open: null, answer: null };

interface Answer {
  question: string;
  text: string | null;
  sources: { key: string; title: string }[];
}

/**
 * Side panel "Knowledge base" tab: search, an in-place reader and, when the tenant enabled agent
 * AI, an answer grounded only in published articles, with its sources. Nothing is sent to the
 * customer; the agent reads and decides.
 */
export function KnowledgeTab({
  sessionId,
  csrf,
  knowledge,
  state,
  onState,
  focusRequested,
  onFocused,
  lastCustomerLine,
  platformItems,
}: {
  sessionId: string;
  csrf: string;
  knowledge: DesktopKnowledge;
  state: KnowledgeState;
  onState: (next: KnowledgeState) => void;
  /** Alt+K asked for the search box; `onFocused` clears the request once it is served. */
  focusRequested: boolean;
  onFocused: () => void;
  lastCustomerLine: string | null;
  platformItems: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [submitted, setSubmitted] = useState(state.query.trim()),
    [asking, setAsking] = useState(false),
    [askFailed, setAskFailed] = useState(false);
  useEffect(() => {
    if (!focusRequested || state.open !== null) return;
    input.current?.focus();
    onFocused();
  }, [focusRequested, onFocused, state.open]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSubmitted(state.query.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state.query]);
  const ai = useQuery({
    queryKey: ['agent-ai-status', sessionId],
    queryFn: ({ signal }) =>
      api('/v1/ai/status', z.object({ agentEnabled: z.boolean() }), undefined, undefined, signal),
    retry: false,
  });
  const results = useQuery({
    queryKey: ['agent', 'knowledge', sessionId, 'search', submitted],
    queryFn: ({ signal }) => knowledge.search(submitted, signal),
    enabled: submitted !== '',
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
  });
  const article = useQuery({
    queryKey: ['agent', 'knowledge', sessionId, 'article', state.open],
    queryFn: ({ signal }) => knowledge.article(state.open ?? '', signal),
    enabled: state.open !== null,
    staleTime: 30_000,
    retry: false,
  });
  const ask = async () => {
    const question = state.query.trim();
    if (question === '') return;
    setAsking(true);
    setAskFailed(false);
    try {
      const suggestion = await api('/v1/ai/suggestions', AiSuggestionSchema, csrf, {
        requestId: crypto.randomUUID(),
        task: 'answer',
        text: question,
        locale: i18n.language === 'en' ? 'en' : 'tr',
        sessionId,
      });
      const value = KnowledgeAnswerSchema.parse(suggestion.value);
      const sources = await Promise.all(
        value.articleKeys.map(async (key) => ({
          key,
          title: (await knowledge.article(key, AbortSignal.timeout(10_000)))?.title ?? key,
        })),
      );
      onState({ ...state, answer: { question, text: value.answer, sources } });
    } catch {
      setAskFailed(true);
    } finally {
      setAsking(false);
    }
  };
  if (state.open !== null)
    return (
      <section className="ag-knowledge" aria-label={t('agent.desktop.knowledge')}>
        {article.isPending ? (
          <p className="ag-muted">{t('agent.desktop.knowledgeBase.searching')}</p>
        ) : article.data ? (
          <article className="ag-knowledge-reader" aria-labelledby="ag-knowledge-title">
            <h3 id="ag-knowledge-title">{article.data.title}</h3>
            <p className="ag-muted">
              {t('agent.desktop.knowledgeBase.updated', {
                date: new Date(article.data.updatedAt).toLocaleDateString(i18n.language),
              })}
            </p>
            <ArticleBody body={article.data.body} headingLevel={4} />
          </article>
        ) : (
          <Alert tone="warning" title={t('agent.desktop.prompts.articleMissing')} />
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onState({ ...state, open: null });
          }}
        >
          {t('agent.desktop.knowledgeBase.back')}
        </Button>
      </section>
    );
  const hits = results.data;
  return (
    <section className="ag-knowledge" aria-label={t('agent.desktop.knowledge')}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(state.query.trim());
        }}
      >
        <Input
          ref={input}
          type="search"
          label={t('agent.desktop.knowledgeBase.search')}
          hint={t('agent.desktop.knowledgeBase.hint')}
          value={state.query}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => {
            onState({ ...state, query: event.target.value });
          }}
        />
      </form>
      <div className="ag-knowledge-actions">
        {lastCustomerLine !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onState({ ...state, query: lastCustomerLine.slice(0, 200) });
              input.current?.focus();
            }}
          >
            {t('agent.desktop.knowledgeBase.useLastLine')}
          </Button>
        )}
        {ai.data?.agentEnabled === true && (
          <Button
            size="sm"
            variant="secondary"
            loading={asking}
            disabled={asking || state.query.trim() === ''}
            onClick={() => void ask()}
          >
            {t('agent.desktop.knowledgeBase.ask')}
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {asking && <p className="ag-muted">{t('agent.desktop.knowledgeBase.asking')}</p>}
        {askFailed && (
          <Alert tone="warning" title={t('agent.desktop.knowledgeBase.answerFailed')} />
        )}
        {state.answer !== null && !asking && (
          <Alert
            tone={state.answer.text === null ? 'neutral' : 'info'}
            title={t('agent.desktop.knowledgeBase.answerTitle')}
          >
            {state.answer.text === null ? (
              <p>{t('agent.desktop.knowledgeBase.notFound')}</p>
            ) : (
              <>
                <p className="ag-knowledge-answer">{state.answer.text}</p>
                <p className="ag-muted">{t('agent.desktop.knowledgeBase.answerCheck')}</p>
                <h3 className="ag-knowledge-sources">{t('agent.desktop.knowledgeBase.sources')}</h3>
                <ul className="ag-knowledge-results">
                  {state.answer.sources.map((source) => (
                    <li key={source.key}>
                      <button
                        type="button"
                        className="ag-knowledge-hit"
                        onClick={() => {
                          onState({ ...state, open: source.key });
                        }}
                      >
                        <strong>{source.title}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Alert>
        )}
      </div>
      <p className="vb-sr-only" role="status">
        {hits === undefined || submitted === ''
          ? ''
          : hits.length === 0
            ? t('agent.desktop.knowledgeBase.none')
            : t('agent.desktop.knowledgeBase.results', { count: hits.length })}
      </p>
      {submitted !== '' && results.isFetching && (
        <p className="ag-muted">{t('agent.desktop.knowledgeBase.searching')}</p>
      )}
      {results.isError && <Alert tone="warning" title={t('agent.desktop.knowledgeBase.failed')} />}
      {submitted !== '' && hits?.length === 0 && (
        <p className="ag-muted">{t('agent.desktop.knowledgeBase.none')}</p>
      )}
      {submitted !== '' && hits !== undefined && hits.length > 0 && (
        <ul className="ag-knowledge-results">
          {hits.map((hit) => (
            <li key={hit.key}>
              <button
                type="button"
                className="ag-knowledge-hit"
                onClick={() => {
                  onState({ ...state, open: hit.key });
                }}
              >
                <strong>{hit.title}</strong> <span>{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {platformItems}
    </section>
  );
}

/** Title of an article a transcript trigger suggests, or null while loading or when missing. */
export function useArticleTitle(
  sessionId: string,
  knowledge: DesktopKnowledge,
  key: string | null,
): { title: string | null; missing: boolean } {
  const query = useQuery({
    queryKey: ['agent', 'knowledge', sessionId, 'article', key],
    queryFn: ({ signal }) => knowledge.article(key ?? '', signal),
    enabled: key !== null,
    staleTime: 30_000,
    retry: false,
  });
  return {
    title: query.data?.title ?? null,
    missing: query.isSuccess && query.data === null,
  };
}
