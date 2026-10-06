import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, ArrowUpRight, LayoutGrid, List, Layers3, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useCan } from '@verbis/authz/react';
import { Button, Badge, DataTable, Input, Select, IconButton, EmptyState, Alert } from '@verbis/ui';

import { list, type ResourceKind, type Resource } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';

import type { Destination } from '../workspace/navigation.js';

export default function Library({
  kind,
  onCreate,
}: {
  kind: Exclude<Destination, 'analytics' | 'ai'>;
  onCreate: (kind: 'campaigns' | 'scripts') => void;
}) {
  const { t, i18n } = useTranslation();
  const { session, environment } = useWorkspace();
  const navigate = useNavigate();
  const resource: ResourceKind =
    kind === 'variables' || kind === 'releases'
      ? 'scripts'
      : kind === 'settings'
        ? 'campaigns'
        : kind;
  const allowed = useCan('create', resource === 'campaigns' ? 'Campaign' : 'Script');
  const canReadTemplates = useCan('read', 'Script');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('all');
  const [owner, setOwner] = useState('all');
  const [view, setView] = useState<'list' | 'cards'>('list');
  const query = useInfiniteQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      environment,
      resource,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => list(resource, signal, pageParam),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
  });
  const all = query.data?.pages.flatMap((page) => page.data) ?? [];
  const rows = all.filter(
    (row) =>
      (row.name
        .toLocaleLowerCase(i18n.language)
        .includes(search.toLocaleLowerCase(i18n.language)) ||
        row.tags.some((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) &&
      (status === 'all' || row.status === status) &&
      (tag === 'all' || row.tags.includes(tag)) &&
      (owner === 'all' ||
        (owner === 'mine' && row.ownerId === session.user.id) ||
        (owner === 'unassigned' && !row.ownerId)),
  );
  const filtered = !!search || status !== 'all' || tag !== 'all' || owner !== 'all';
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setTag('all');
    setOwner('all');
  };
  const tags = [...new Set(all.flatMap((row) => row.tags))];
  const statuses = [...new Set(all.flatMap((row) => (row.status ? [row.status] : [])))];
  const open = (row: Resource) => {
    if (resource === 'campaigns') void navigate(`/campaigns/${row.id}`);
    else if (resource === 'scripts')
      void navigate(
        `/scripts/${row.id}${kind === 'variables' ? '/variables' : kind === 'releases' ? '/releases' : ''}`,
      );
  };
  const statusLabel = (value: string | undefined) =>
    value
      ? t(`designer.workspace.status.${value}`, { defaultValue: value })
      : t('designer.workspace.unassigned');
  const editable = resource === 'campaigns' || resource === 'scripts';
  return (
    <section className="dw-library">
      <div className="dw-page-heading">
        <div>
          <div className="dw-eyebrow">
            <Sparkles size={14} aria-hidden />
            {t('designer.workspace.studio')}
          </div>
          <h1>
            {t(`designer.workspace.nav.${kind}`)}
            <span className="dw-count">{all.length}</span>
          </h1>
          <p>{t(`designer.workspace.descriptions.${kind}`)}</p>
        </div>
        {editable && allowed && (
          <Button
            startIcon={<Plus size={16} aria-hidden />}
            onClick={() => {
              onCreate(resource);
            }}
          >
            {t(`designer.workspace.new.${resource}`)}
          </Button>
        )}
      </div>
      {kind === 'campaigns' && canReadTemplates && (
        <div className="dw-hero">
          <div>
            <Badge tone="info">{t('designer.workspace.heroEyebrow')}</Badge>
            <h2>{t('designer.workspace.heroTitle')}</h2>
            <p>{t('designer.workspace.heroDescription')}</p>
            <Button
              variant="secondary"
              endIcon={<ArrowUpRight size={16} aria-hidden />}
              onClick={() => {
                void navigate('/templates');
              }}
            >
              {t('designer.workspace.exploreTemplates')}
            </Button>
          </div>
          <div className="dw-hero-canvas" aria-hidden>
            <div className="dw-canvas-node">
              <Layers3 size={24} />
              <span>{t('designer.workspace.canvasLabel')}</span>
            </div>
            <div className="dw-canvas-line" />
            <div className="dw-canvas-branches">
              <span />
              <span />
            </div>
          </div>
        </div>
      )}
      <div className="dw-list-toolbar">
        <div className="dw-search">
          <Search size={16} aria-hidden />
          <Input
            label={t('designer.workspace.searchLibrary')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder={t('designer.workspace.searchPlaceholder')}
          />
        </div>
        <Select
          label={t('designer.workspace.statusFilter')}
          value={status}
          options={[
            { value: 'all', label: t('designer.workspace.allStatuses') },
            ...statuses.map((value) => ({ value, label: statusLabel(value) })),
          ]}
          onValueChange={setStatus}
        />
        <Select
          label={t('designer.workspace.tags')}
          value={tag}
          options={[
            { value: 'all', label: t('designer.workspace.allTags') },
            ...tags.map((value) => ({ value, label: value })),
          ]}
          onValueChange={setTag}
        />
        <Select
          label={t('designer.workspace.owner')}
          value={owner}
          options={['all', 'mine', 'unassigned'].map((value) => ({
            value,
            label: t(`designer.workspace.owners.${value}`),
          }))}
          onValueChange={setOwner}
        />
        <div className="dw-view-toggle">
          <IconButton
            label={t('designer.workspace.listView')}
            aria-pressed={view === 'list'}
            onClick={() => {
              setView('list');
            }}
          >
            <List size={17} />
          </IconButton>
          <IconButton
            label={t('designer.workspace.cardView')}
            aria-pressed={view === 'cards'}
            onClick={() => {
              setView('cards');
            }}
          >
            <LayoutGrid size={17} />
          </IconButton>
        </div>
      </div>
      {filtered && (
        <Button variant="ghost" onClick={clearFilters}>
          {t('designer.workspace.clearFilters')}
        </Button>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <Failure
          retry={() => {
            void query.refetch();
          }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon={<Layers3 size={34} aria-hidden />}
          title={t(filtered ? 'designer.workspace.noResults' : 'designer.workspace.emptyTitle')}
          description={t(
            filtered
              ? 'designer.workspace.noResultsDescription'
              : 'designer.workspace.emptyDescription',
          )}
          action={
            !filtered && editable && allowed ? (
              <Button
                onClick={() => {
                  onCreate(resource);
                }}
              >
                {t(`designer.workspace.new.${resource}`)}
              </Button>
            ) : undefined
          }
        />
      ) : view === 'cards' ? (
        <div className="dw-card-grid">
          {rows.map((row) => (
            <article key={row.id} className="dw-resource-card">
              <div className="dw-card-top">
                <span className="dw-resource-icon">
                  <Layers3 size={23} aria-hidden />
                </span>
                <Badge
                  tone={
                    row.status === 'active' || row.status === 'PUBLISHED' ? 'success' : 'neutral'
                  }
                >
                  {statusLabel(row.status)}
                </Badge>
              </div>
              <h2>
                {editable ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      open(row);
                    }}
                  >
                    {row.name}
                    <ArrowUpRight size={14} aria-hidden />
                  </Button>
                ) : (
                  row.name
                )}
              </h2>
              <p>{row.description ?? t('designer.workspace.noDescription')}</p>
              <div className="dw-tags">
                {row.tags.map((value) => (
                  <Badge key={value}>{value}</Badge>
                ))}
              </div>
              <footer>
                <span>
                  {t('designer.workspace.owner')}:{' '}
                  {row.ownerId ?? t('designer.workspace.unassigned')}
                </span>
                <time>
                  {row.updatedAt
                    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                        new Date(row.updatedAt),
                      )
                    : t('designer.workspace.unassigned')}
                </time>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <DataTable<Resource>
          label={t(`designer.workspace.nav.${kind}`)}
          data={rows}
          getRowId={(row) => row.id}
          height={440}
          columns={[
            {
              id: 'name',
              header: t('designer.workspace.name'),
              accessor: (row) => row.name,
              cell: (row) =>
                editable ? (
                  <Button
                    variant="ghost"
                    className="dw-table-name"
                    onClick={() => {
                      open(row);
                    }}
                  >
                    <Layers3 size={16} aria-hidden />
                    {row.name}
                  </Button>
                ) : (
                  row.name
                ),
              size: 300,
            },
            {
              id: 'status',
              header: t('designer.workspace.statusFilter'),
              accessor: (row) => statusLabel(row.status),
              cell: (row) => (
                <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
                  {statusLabel(row.status)}
                </Badge>
              ),
            },
            {
              id: 'tags',
              header: t('designer.workspace.tags'),
              accessor: (row) => row.tags.join(', '),
              cell: (row) => (
                <div className="dw-tags">
                  {row.tags.map((value) => (
                    <Badge key={value}>{value}</Badge>
                  ))}
                </div>
              ),
            },
            {
              id: 'owner',
              header: t('designer.workspace.owner'),
              accessor: (row) => row.ownerId ?? t('designer.workspace.unassigned'),
            },
            {
              id: 'updatedAt',
              header: t('designer.workspace.edited'),
              accessor: (row) => row.updatedAt ?? '',
              cell: (row) =>
                row.updatedAt
                  ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                      new Date(row.updatedAt),
                    )
                  : t('designer.workspace.unassigned'),
            },
          ]}
        />
      )}{' '}
      {query.isRefetchError && !query.isFetchNextPageError && (
        <Alert tone="danger" title={t('designer.workspace.refreshError')}>
          <Button
            variant="secondary"
            loading={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('designer.workspace.retry')}
          </Button>
        </Alert>
      )}
      {query.isFetchNextPageError && (
        <Alert tone="danger" title={t('designer.workspace.moreError')}>
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {t('designer.workspace.retry')}
          </Button>
        </Alert>
      )}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <Button
          variant="secondary"
          loading={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t('designer.workspace.loadMore')}
        </Button>
      )}
    </section>
  );
}
