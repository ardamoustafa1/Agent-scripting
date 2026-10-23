import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';

import { useAbility } from '@verbis/authz/react';
import {
  CreateKnowledgeArticleSchema,
  KNOWLEDGE_LIMITS,
  KnowledgeArticleSchema,
  UpdateKnowledgeArticleSchema,
  type KnowledgeArticle,
} from '@verbis/shared-types';
import { Alert, ArticleBody, Badge, Button, Dialog, Input, Select, Textarea } from '@verbis/ui';

import { ApiError, request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { Failure, Forbidden, Loading } from '../workspace/states.js';

import { keyFromTitle, knowledgeKey, parseTags } from './api.js';
import { STATUS_TONE } from './list.js';
import './styles.css';

interface Draft {
  key: string;
  title: string;
  body: string;
  tags: string;
  locale: string;
}
type Problem = 'keyTaken' | 'conflict' | 'saveError' | 'invalid';

/** One knowledge article: write, preview as agents see it, publish or archive (ADR-0057). */
export default function KnowledgeEditorPage() {
  const { id } = useParams(),
    { session } = useWorkspace(),
    ability = useAbility();
  const isNew = id === 'new';
  const query = useQuery({
    queryKey: knowledgeKey(session, 'article', id),
    queryFn: ({ signal }) =>
      request(`/v1/knowledge-articles/${id ?? ''}`, KnowledgeArticleSchema, { signal }),
    enabled: !isNew,
    refetchOnWindowFocus: false,
  });
  if (isNew) return ability.can('create', 'KnowledgeArticle') ? <ArticleEditor /> : <Forbidden />;
  if (query.isError)
    return (
      <Failure
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (!query.data) return <Loading />;
  return (
    <ArticleEditor key={`${query.data.id}-${String(query.data.version)}`} initial={query.data} />
  );
}

function ArticleEditor({ initial }: { initial?: KnowledgeArticle }) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    key: initial?.key ?? '',
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    tags: initial?.tags.join(', ') ?? '',
    locale: initial?.locale ?? 'tr',
  }));
  const [saved, setSaved] = useState(() => JSON.stringify(draft)),
    [keyTouched, setKeyTouched] = useState(initial !== undefined),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState<Problem | null>(null),
    [destination, setDestination] = useState('');
  const dirty = saved !== JSON.stringify(draft),
    editable = ability.can(initial ? 'update' : 'create', 'KnowledgeArticle'),
    canPublish = initial !== undefined && ability.can('publish', 'KnowledgeArticle');
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (destination && !dirty) void navigate(destination, { replace: true });
  }, [destination, dirty, navigate]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty]);
  const stored = (article: KnowledgeArticle) => {
    cache.setQueryData(knowledgeKey(session, 'article', article.id), article);
    void cache.invalidateQueries({ queryKey: knowledgeKey(session, 'list') });
  };
  const fail = (error: unknown) => {
    setProblem(
      error instanceof ApiError && error.code === 'VERBIS_RESOURCE_CONFLICT' && !initial
        ? 'keyTaken'
        : error instanceof ApiError && [409, 412].includes(error.status)
          ? 'conflict'
          : error instanceof ApiError && error.status === 400
            ? 'invalid'
            : 'saveError',
    );
  };
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const content = {
        title: draft.title,
        body: draft.body,
        tags: parseTags(draft.tags),
        locale: draft.locale,
      };
      const article = initial
        ? await request(`/v1/knowledge-articles/${initial.id}`, KnowledgeArticleSchema, {
            method: 'PATCH',
            body: UpdateKnowledgeArticleSchema.parse(content),
            ifMatch: `"${String(initial.version)}"`,
            csrf: session.csrfToken,
          })
        : await request('/v1/knowledge-articles', KnowledgeArticleSchema, {
            method: 'POST',
            body: CreateKnowledgeArticleSchema.parse({ ...content, key: draft.key }),
            csrf: session.csrfToken,
          });
      setSaved(JSON.stringify(draft));
      stored(article);
      setDestination(`/knowledge/${article.id}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') setProblem('invalid');
      else fail(error);
    } finally {
      setBusy(false);
    }
  };
  const transition = async (action: 'publish' | 'archive') => {
    if (!initial) return;
    setBusy(true);
    setProblem(null);
    try {
      const article = await request(
        `/v1/knowledge-articles/${initial.id}/${action}`,
        KnowledgeArticleSchema,
        { method: 'POST', ifMatch: `"${String(initial.version)}"`, csrf: session.csrfToken },
      );
      stored(article);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const status = initial?.status ?? 'draft';
  return (
    <section className="kb-stack">
      <Link to="/knowledge" className="dw-back">
        {t('designer.workspace.back')}
      </Link>
      <div className="dw-page-heading">
        <div>
          <Badge tone={STATUS_TONE[status]}>{t(`designer.knowledge.statuses.${status}`)}</Badge>
          <h1>{initial?.title ?? t('designer.knowledge.create')}</h1>
          <p>{t(`designer.knowledge.notes.${status}`)}</p>
        </div>
        <div className="kb-actions">
          {canPublish && status !== 'published' && (
            <Button
              variant="secondary"
              disabled={busy || dirty}
              onClick={() => void transition('publish')}
            >
              {t(
                status === 'archived'
                  ? 'designer.knowledge.republish'
                  : 'designer.knowledge.publish',
              )}
            </Button>
          )}
          {canPublish && status !== 'archived' && (
            <Button
              variant="ghost"
              disabled={busy || dirty}
              onClick={() => void transition('archive')}
            >
              {t('designer.knowledge.archive')}
            </Button>
          )}
          <Button
            disabled={!editable || busy || !dirty || draft.title.trim() === '' || draft.key === ''}
            loading={busy}
            onClick={() => void save()}
          >
            {t('designer.knowledge.save')}
          </Button>
        </div>
      </div>
      {canPublish && dirty && status !== 'published' && (
        <p className="kb-muted">{t('designer.knowledge.saveFirst')}</p>
      )}
      {problem && <Alert tone="danger" title={t(`designer.knowledge.errors.${problem}`)} />}
      <div className="kb-editor">
        <fieldset className="kb-form" disabled={!editable || busy}>
          <legend className="vb-sr-only">{t('designer.knowledge.title')}</legend>
          <Input
            label={t('designer.knowledge.articleTitle')}
            value={draft.title}
            maxLength={KNOWLEDGE_LIMITS.maxTitle}
            required
            onChange={(event) => {
              const title = event.target.value;
              setDraft((d) => ({
                ...d,
                title,
                ...(keyTouched ? {} : { key: keyFromTitle(title) }),
              }));
            }}
          />
          <Input
            label={t('designer.knowledge.key')}
            hint={t('designer.knowledge.keyHelp')}
            value={draft.key}
            maxLength={KNOWLEDGE_LIMITS.maxKey}
            readOnly={initial !== undefined}
            pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
            spellCheck={false}
            onChange={(event) => {
              setKeyTouched(true);
              setDraft((d) => ({ ...d, key: event.target.value.toLowerCase() }));
            }}
          />
          <div className="kb-row">
            <Input
              label={t('designer.knowledge.tags')}
              hint={t('designer.knowledge.tagsHelp')}
              value={draft.tags}
              onChange={(event) => {
                setDraft((d) => ({ ...d, tags: event.target.value }));
              }}
            />
            <Select
              label={t('designer.knowledge.locale')}
              value={draft.locale}
              options={['tr', 'en'].map((value) => ({
                value,
                label: t(`designer.knowledge.locales.${value}`),
              }))}
              onValueChange={(locale) => {
                setDraft((d) => ({ ...d, locale }));
              }}
            />
          </div>
          <Textarea
            label={t('designer.knowledge.body')}
            hint={t('designer.knowledge.bodyHelp')}
            value={draft.body}
            rows={16}
            maxLength={KNOWLEDGE_LIMITS.maxBody}
            onChange={(event) => {
              setDraft((d) => ({ ...d, body: event.target.value }));
            }}
          />
        </fieldset>
        <section className="kb-preview" aria-labelledby="kb-preview-title">
          <h2 id="kb-preview-title">{t('designer.knowledge.preview')}</h2>
          <div className="kb-preview-card">
            <h3>{draft.title || t('designer.knowledge.articleTitle')}</h3>
            {draft.body.trim() === '' ? (
              <p className="kb-muted">{t('designer.knowledge.previewEmpty')}</p>
            ) : (
              <ArticleBody body={draft.body} headingLevel={4} />
            )}
          </div>
        </section>
      </div>
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title={t('designer.knowledge.unsaved')}
        description={t('designer.knowledge.unsavedHelp')}
      >
        <Button
          onClick={() => {
            if (blocker.state === 'blocked') blocker.reset();
          }}
        >
          {t('designer.knowledge.stay')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (blocker.state === 'blocked') blocker.proceed();
          }}
        >
          {t('designer.knowledge.leave')}
        </Button>
      </Dialog>
    </section>
  );
}
