import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { IntegrationRecordSchema, IntegrationMetricsSchema } from '@verbis/shared-types';
import { Button, Input, Select, Badge, DataTable, EmptyState } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import './styles.css';
import { Loading, Failure } from '../workspace/states.js';

function Health({ id }: { id: string }) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace();
  const metrics = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'integration',
      id,
      'metrics',
    ],
    queryFn: ({ signal }) =>
      request(`/v1/data-sources/${id}/metrics`, IntegrationMetricsSchema, { signal }),
    staleTime: 30000,
  });
  const metric = metrics.data?.find((m) => m.profile === environment);
  return (
    <Badge
      tone={
        !metric ? 'neutral' : metric.errorRate > 0.1 || metric.breaker !== 0 ? 'warning' : 'success'
      }
    >
      {metric
        ? `${((1 - metric.errorRate) * 100).toFixed(1)}% · ${t(`designer.integrations.breaker.${metric.breaker === 0 ? 'closed' : metric.breaker === 1 ? 'open' : 'halfOpen'}`)}`
        : t('designer.integrations.noMetrics')}
    </Badge>
  );
}
export default function IntegrationList() {
  const { t } = useTranslation(),
    ability = useAbility(),
    { session, environment } = useWorkspace();
  const [search, setSearch] = useState(''),
    [protocol, setProtocol] = useState('all');
  const query = useInfiniteQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'integrations',
      protocol,
      search.trim(),
    ],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      request(
        `/v1/data-sources?limit=50${protocol === 'all' ? '' : `&protocol=${protocol}`}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        z.object({
          data: z.array(IntegrationRecordSchema),
          page: z.object({ nextCursor: z.string().nullable() }),
        }),
        { signal },
      ),
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
  const rows = query.data.pages.flatMap((p) => p.data);
  return (
    <section className="ig-stack">
      <div className="dw-page-heading">
        <div>
          <h1>{t('designer.integrations.title')}</h1>
          <p>{t('designer.integrations.subtitle')}</p>
        </div>
        {ability.can('create', 'Integration') && (
          <Link className="vb-button" data-variant="primary" data-size="md" to="/integrations/new">
            {t('designer.integrations.create')}
          </Link>
        )}
      </div>
      <div className="ig-row">
        <Input
          label={t('designer.integrations.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <Select
          label={t('designer.integrations.protocol')}
          value={protocol}
          options={['all', 'rest', 'soap', 'graphql', 'sql'].map((value) => ({
            value,
            label: value === 'all' ? t('designer.integrations.all') : value.toUpperCase(),
          }))}
          onValueChange={setProtocol}
        />
      </div>
      {rows.length ? (
        <DataTable
          label={t('designer.integrations.title')}
          data={rows}
          getRowId={(r) => r.id}
          columns={[
            {
              id: 'key',
              header: t('designer.integrations.name'),
              accessor: (r) => r.key,
              cell: (r) => (
                <Link to={`/integrations/${r.id}`} className="dw-link">
                  {r.key}
                </Link>
              ),
            },
            {
              id: 'protocol',
              header: t('designer.integrations.protocol'),
              accessor: (r) => r.protocol,
            },
            {
              id: 'environment',
              header: t('designer.integrations.environment'),
              accessor: () => environment,
            },
            {
              id: 'health',
              header: t('designer.integrations.health'),
              accessor: (r) => r.id,
              cell: (r) => <Health id={r.id} />,
            },
            {
              id: 'usage',
              header: t('designer.integrations.usage'),
              accessor: (r) => r.id,
              cell: (r) => <Usage id={r.id} />,
            },
          ]}
        />
      ) : (
        <EmptyState
          headingLevel={2}
          title={t('designer.integrations.empty')}
          description={t('designer.integrations.subtitle')}
        />
      )}
      {query.hasNextPage && (
        <Button
          loading={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t('designer.integrations.more')}
        </Button>
      )}
    </section>
  );
}
function Usage({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility();
  const query = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'integration',
      id,
      'usage',
    ],
    queryFn: ({ signal }) =>
      request(
        `/v1/data-sources/${id}/usage`,
        z.object({
          data: z.array(z.object({ scriptId: z.uuid(), name: z.string(), number: z.number() })),
          truncated: z.boolean(),
        }),
        { signal },
      ),
    enabled: open && ability.can('read', 'Script'),
    staleTime: 60000,
  });
  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        {t('designer.integrations.consumers', { count: query.data?.data.length ?? 0 })}
      </summary>
      {query.data?.data.map((s) => (
        <p key={`${s.scriptId}-${s.number}`}>
          <Link to={`/scripts/${s.scriptId}`}>
            {t('designer.integrations.scriptVersion', { name: s.name, version: s.number })}
          </Link>
        </p>
      ))}
      {query.data?.truncated && <p>{t('designer.integrations.truncated')}</p>}
    </details>
  );
}
