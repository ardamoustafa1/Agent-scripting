import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  Plus,
  ArrowUpRight,
  Headset,
  LayoutGrid,
  List,
  Layers3,
  Search,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useCan } from '@verbis/authz/react';
import { Button, Badge, DataTable, Input, Select, IconButton, EmptyState, Alert } from '@verbis/ui';

import { list, request, type ResourceKind, type Resource } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';

import SharedScreens from './shared-screens.js';

import type { Destination } from '../workspace/navigation.js';

const PeopleSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function LibraryBody({
  kind,
  onCreate,
}: {
  kind: Exclude<Destination, 'analytics' | 'ai' | 'knowledge'>;
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
  // Archived rows stay out of the way until the author asks for them.
  const [status, setStatus] = useState('current');
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
  // Rows carry their creator as an actor reference (`user:<id>`, `service:<name>`).
  const creatorUser = (row: Resource): string | undefined => {
    if (!row.createdBy) return undefined;
    const [kind, ...rest] = row.createdBy.includes(':')
      ? row.createdBy.split(':')
      : ['user', row.createdBy];
    return kind === 'user' ? rest.join(':') : undefined;
  };
  const creator = (row: Resource): 'mine' | 'member' | 'system' | undefined =>
    !row.createdBy
      ? undefined
      : creatorUser(row) === undefined
        ? 'system'
        : creatorUser(row) === session.user.id
          ? 'mine'
          : 'member';
  // Teammates' names, at most 100 per request; until they arrive the row says "team member".
  const teammates = [
    ...new Set(
      all.flatMap((row) => {
        const id = creatorUser(row);
        return id !== undefined && id !== session.user.id && UUID.test(id) ? [id] : [];
      }),
    ),
  ]
    .sort()
    .slice(0, 100);
  const people = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'people',
      teammates.join(','),
    ],
    enabled: teammates.length > 0 && (resource === 'campaigns' || resource === 'scripts'),
    queryFn: ({ signal }) =>
      request(`/v1/people?ids=${teammates.join(',')}`, PeopleSchema, { signal }),
    retry: false,
  });
  const creatorName = (row: Resource) => {
    const kind = creator(row);
    if (kind === 'mine') return t('designer.workspace.you');
    if (kind === 'member') {
      const id = creatorUser(row);
      const name = people.data?.find((person) => person.id === id)?.name;
      if (name) return name;
      // Answered without this person: no longer an active member of the team.
      return people.isSuccess && teammates.includes(id ?? '')
        ? t('designer.workspace.owners.former')
        : t('designer.workspace.owners.member');
    }
    return kind ? t(`designer.workspace.owners.${kind}`) : t('designer.workspace.unassigned');
  };
  const rows = all.filter(
    (row) =>
      (row.name
        .toLocaleLowerCase(i18n.language)
        .includes(search.toLocaleLowerCase(i18n.language)) ||
        row.tags.some((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) &&
      (status === 'all' ||
        (status === 'current' ? row.status !== 'archived' : row.status === status)) &&
      (tag === 'all' || row.tags.includes(tag)) &&
      (owner === 'all' || (owner === 'mine' ? creator(row) === 'mine' : creator(row) !== 'mine')),
  );
  const filtered = !!search || status !== 'current' || tag !== 'all' || owner !== 'all';
  const clearFilters = () => {
    setSearch('');
    setStatus('current');
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
            <span className="dw-count">
              {all.filter((row) => row.status !== 'archived').length}
            </span>
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
              <span>
                <ShoppingCart size={15} />
                {t('designer.workspace.canvasBranchSale')}
              </span>
              <span>
                <Headset size={15} />
                {t('designer.workspace.canvasBranchSupport')}
              </span>
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
            { value: 'current', label: t('designer.workspace.currentStatuses') },
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
        {editable && (
          <Select
            label={t('designer.workspace.createdBy')}
            value={owner}
            options={['all', 'mine', 'others'].map((value) => ({
              value,
              label: t(`designer.workspace.owners.${value}`),
            }))}
            onValueChange={setOwner}
          />
        )}
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
          error={query.error}
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
                {editable && (
                  <span>
                    {t('designer.workspace.createdBy')}: {creatorName(row)}
                  </span>
                )}
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
          // The search above already filters the list; a second box would only confuse.
          filterable={false}
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
            ...(editable
              ? [
                  {
                    id: 'createdBy',
                    header: t('designer.workspace.createdBy'),
                    accessor: creatorName,
                  },
                ]
              : []),
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

export default function Library(props: Parameters<typeof LibraryBody>[0]) {
  return props.kind === 'screens' ? <SharedScreens /> : <LibraryBody {...props} />;
}
