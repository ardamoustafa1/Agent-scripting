import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAbility } from '@verbis/authz/react';
import { type KnowledgeArticleStatus } from '@verbis/shared-types';
import { Badge, Button, DataTable, EmptyState, Input, Select } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { Failure, Loading } from '../workspace/states.js';

import { ArticlePageSchema, knowledgeKey } from './api.js';
import './styles.css';

export const STATUS_TONE = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
} as const satisfies Record<KnowledgeArticleStatus, string>;

/** Knowledge base articles agents read beside the script (ADR-0057). */
export default function KnowledgeList() {
  const { t, i18n } = useTranslation(),
    ability = useAbility(),
    { session } = useWorkspace();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all');
  const query = useInfiniteQuery({
    queryKey: knowledgeKey(session, 'list', status, search.trim()),
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (status !== 'all') params.set('status', status);
      if (search.trim()) params.set('q', search.trim());
      if (pageParam) params.set('cursor', pageParam);
      return request(`/v1/knowledge-articles?${params.toString()}`, ArticlePageSchema, { signal });
    },
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
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
  const rows = query.data.pages.flatMap((page) => page.data);
  return (
    <section className="kb-stack">
      <div className="dw-page-heading">
        <div>
          <h1>{t('designer.knowledge.title')}</h1>
          <p>{t('designer.knowledge.subtitle')}</p>
        </div>
        {ability.can('create', 'KnowledgeArticle') && (
          <Link className="vb-button" data-variant="primary" data-size="md" to="/knowledge/new">
            {t('designer.knowledge.create')}
          </Link>
        )}
      </div>
      <div className="kb-row">
        <Input
          type="search"
          label={t('designer.knowledge.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <Select
          label={t('designer.knowledge.status')}
          value={status}
          options={['all', 'draft', 'published', 'archived'].map((value) => ({
            value,
            label: t(`designer.knowledge.statuses.${value}`),
          }))}
          onValueChange={setStatus}
        />
      </div>
      {rows.length ? (
        <DataTable
          label={t('designer.knowledge.title')}
          data={rows}
          getRowId={(row) => row.id}
          columns={[
            {
              id: 'title',
              header: t('designer.knowledge.articleTitle'),
              accessor: (row) => row.title,
              cell: (row) => (
                <Link to={`/knowledge/${row.id}`} className="dw-link">
                  {row.title}
                </Link>
              ),
            },
            {
              id: 'key',
              header: t('designer.knowledge.key'),
              accessor: (row) => row.key,
              cell: (row) => <code>{row.key}</code>,
            },
            {
              id: 'status',
              header: t('designer.knowledge.status'),
              accessor: (row) => row.status,
              cell: (row) => (
                <Badge tone={STATUS_TONE[row.status]}>
                  {t(`designer.knowledge.statuses.${row.status}`)}
                </Badge>
              ),
            },
            {
              id: 'tags',
              header: t('designer.knowledge.tags'),
              accessor: (row) => row.tags.join(', '),
            },
            {
              id: 'updatedAt',
              header: t('designer.knowledge.updated'),
              accessor: (row) => row.updatedAt,
              cell: (row) => new Date(row.updatedAt).toLocaleDateString(i18n.language),
            },
          ]}
        />
      ) : (
        <EmptyState
          headingLevel={2}
          title={t('designer.knowledge.empty')}
          description={t('designer.knowledge.emptyHelp')}
        />
      )}
      {query.hasNextPage && (
        <Button
          loading={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t('designer.knowledge.more')}
        </Button>
      )}
    </section>
  );
}
