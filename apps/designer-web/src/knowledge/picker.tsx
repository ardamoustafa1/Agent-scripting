import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Input } from '@verbis/ui';

import { useWorkspace } from '../workspace/context.js';

import { articleByKey, knowledgeKey, searchArticles } from './api.js';

/** Waits this long after typing stops before searching. */
const SEARCH_DELAY_MS = 300;

/**
 * Picks knowledge articles by key (ADR-0057) for a `knowledgePanel` or a trigger's article
 * suggestion. Chosen keys show their title and state; a key with no article says so, because a
 * script may come from another tenant or reference an article that was archived.
 */
export function ArticlePicker({
  label,
  value,
  max,
  disabled = false,
  removable = true,
  onChange,
}: {
  label: string;
  value: readonly string[];
  max: number;
  disabled?: boolean;
  /** False when a choice can only be replaced (a required single article). */
  removable?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    heading = useId();
  const [query, setQuery] = useState(''),
    [submitted, setSubmitted] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSubmitted(query.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  const results = useQuery({
    queryKey: knowledgeKey(session, 'search', submitted),
    queryFn: ({ signal }) => searchArticles(submitted, signal),
    enabled: submitted !== '',
    staleTime: 30_000,
  });
  const full = value.length >= max;
  return (
    <div className="kb-picker" role="group" aria-labelledby={heading}>
      <span id={heading} className="kb-picker-label">
        {label}
      </span>
      {value.length === 0 ? (
        <p className="kb-muted">{t('designer.knowledge.picker.none')}</p>
      ) : (
        <ul className="kb-picker-chosen">
          {value.map((key) => (
            <ChosenArticle
              key={key}
              articleKey={key}
              disabled={disabled}
              {...(removable
                ? {
                    onRemove: () => {
                      onChange(value.filter((other) => other !== key));
                    },
                  }
                : {})}
            />
          ))}
        </ul>
      )}
      <Input
        type="search"
        label={t('designer.knowledge.picker.search')}
        {...(max > 1 ? { hint: t('designer.knowledge.picker.limit', { count: max }) } : {})}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {submitted !== '' && results.data?.length === 0 && (
        <p className="kb-muted">{t('designer.knowledge.picker.noResults')}</p>
      )}
      {submitted !== '' && results.data && results.data.length > 0 && (
        <ul className="kb-picker-results">
          {results.data.map((hit) => (
            <li key={hit.key}>
              <span>
                {hit.title} <code>{hit.key}</code>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || value.includes(hit.key) || (full && max > 1)}
                aria-label={t('designer.knowledge.picker.add', { title: hit.title })}
                onClick={() => {
                  onChange(max === 1 ? [hit.key] : [...value, hit.key]);
                  setQuery('');
                }}
              >
                {t('designer.knowledge.picker.addShort')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChosenArticle({
  articleKey,
  disabled,
  onRemove,
}: {
  articleKey: string;
  disabled: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace();
  const article = useQuery({
    queryKey: knowledgeKey(session, 'by-key', articleKey),
    queryFn: ({ signal }) => articleByKey(articleKey, signal),
    staleTime: 30_000,
  });
  const title = article.data?.title ?? articleKey;
  return (
    <li>
      <span>
        {title} <code>{articleKey}</code>{' '}
        {article.isSuccess && article.data === null && (
          <Badge tone="danger">{t('designer.knowledge.picker.missing')}</Badge>
        )}
        {article.data && article.data.status !== 'published' && (
          <Badge tone="warning">{t('designer.knowledge.picker.notPublished')}</Badge>
        )}
      </span>
      {onRemove && (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={t('designer.knowledge.picker.remove', { title })}
          onClick={onRemove}
        >
          {t('designer.knowledge.picker.removeShort')}
        </Button>
      )}
    </li>
  );
}
