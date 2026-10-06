import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';

import { useAbility } from '@verbis/authz/react';
import { Badge, DataTable, EmptyState, Tabs } from '@verbis/ui';

import { request, CampaignSchema, AssignmentsSchema } from '../api/client.js';
import { AssignmentRule } from '../rules/assignment-rule.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';

import { CampaignSettings } from './campaign-settings.js';

export default function Campaign() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const ability = useAbility();
  const { session, environment } = useWorkspace();
  const valid = !!id && /^[a-f0-9-]{36}$/i.test(id);
  const campaign = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      environment,
      'campaign',
      id,
    ],
    queryFn: ({ signal }) => request(`/v1/campaigns/${id ?? ''}`, CampaignSchema, { signal }),
    enabled: valid,
  });
  const assignments = useInfiniteQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      environment,
      'assignments',
      id,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      request(
        `/v1/assignments?${new URLSearchParams({ campaignId: id ?? '', limit: '100', ...(pageParam ? { cursor: pageParam } : {}) })}`,
        AssignmentsSchema,
        { signal },
      ),
    enabled: valid,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
  });
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value),
        )
      : t('designer.workspace.noLimit');
  if (!valid || campaign.isError)
    return (
      <Failure
        error={campaign.error}
        retry={() => {
          void campaign.refetch();
        }}
      />
    );
  if (!campaign.data) return <Loading />;
  const rows = assignments.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section>
      <Link className="dw-back" to="/campaigns">
        {t('designer.workspace.back')}
      </Link>
      <div className="dw-page-heading">
        <div>
          <div className="dw-eyebrow">{t('designer.workspace.campaignDetail')}</div>
          <h1>{campaign.data.name}</h1>
          <p>{campaign.data.description}</p>
        </div>
        <Badge tone={campaign.data.status === 'active' ? 'success' : 'neutral'}>
          {t(`designer.workspace.status.${campaign.data.status}`)}
        </Badge>
      </div>
      <div className="dw-detail-summary">
        <div>
          <span>{t('designer.workspace.channels')}</span>
          <strong>{campaign.data.channels.join(' · ')}</strong>
        </div>
        <div>
          <span>{t('designer.workspace.validFrom')}</span>
          <strong>{date(campaign.data.startsAt)}</strong>
        </div>
        <div>
          <span>{t('designer.workspace.validTo')}</span>
          <strong>{date(campaign.data.endsAt)}</strong>
        </div>
      </div>
      <Tabs
        label={t('designer.workspace.campaignDetail')}
        items={[
          ...(ability.can('update', 'Campaign')
            ? [
                {
                  value: 'settings',
                  label: t('designer.campaign.settings'),
                  content: <CampaignSettings key={campaign.data.id} campaign={campaign.data} />,
                },
              ]
            : []),
          {
            value: 'scripts',
            label: t('designer.workspace.assignedScripts'),
            content: assignments.isError ? (
              <Failure
                error={assignments.error}
                retry={() => {
                  void assignments.refetch();
                }}
              />
            ) : assignments.isPending ? (
              <Loading />
            ) : rows.length ? (
              <DataTable
                label={t('designer.workspace.assignedScripts')}
                data={rows}
                getRowId={(row) => row.id}
                columns={[
                  {
                    id: 'script',
                    header: t('designer.workspace.nav.scripts'),
                    accessor: (row) => row.scriptId,
                    cell: (row) => (
                      <Link className="dw-link" to={`/scripts/${row.scriptId}`}>
                        {row.scriptId}
                      </Link>
                    ),
                    size: 300,
                  },
                  {
                    id: 'conditions',
                    accessor: (row) => row.id,
                    header: t('designer.rules.title'),
                    cell: (row) => <AssignmentRule id={row.id} ab={!!row.variants?.length} />,
                  },
                  {
                    id: 'priority',
                    header: t('designer.workspace.priority'),
                    accessor: (row) => row.priority,
                  },
                  {
                    id: 'ab',
                    header: t('designer.workspace.ab'),
                    accessor: (row) =>
                      row.variants
                        ?.map((variant) => `${variant.key}: ${variant.weight / 100}%`)
                        .join(' / ') ?? t('designer.workspace.standard'),
                  },
                  {
                    id: 'from',
                    header: t('designer.workspace.validFrom'),
                    accessor: (row) => date(row.effectiveFrom),
                  },
                  {
                    id: 'to',
                    header: t('designer.workspace.validTo'),
                    accessor: (row) => date(row.effectiveTo),
                  },
                ]}
              />
            ) : (
              <EmptyState
                title={t('designer.workspace.noAssignments')}
                description={t('designer.workspace.noAssignmentsDetail')}
              />
            ),
          },
          {
            value: 'mappings',
            label: t('designer.workspace.externalMappings'),
            content: (
              <DataTable
                label={t('designer.workspace.externalMappings')}
                data={campaign.data.externalMappings}
                getRowId={(row) => `${row.platform}:${row.kind}:${row.externalId}`}
                columns={[
                  {
                    id: 'platform',
                    header: t('designer.workspace.platform'),
                    accessor: (row) => row.platform,
                  },
                  { id: 'kind', header: t('designer.workspace.kind'), accessor: (row) => row.kind },
                  {
                    id: 'id',
                    header: t('designer.workspace.externalId'),
                    accessor: (row) => row.externalId,
                    size: 340,
                  },
                ]}
              />
            ),
          },
        ]}
      />
      {assignments.hasNextPage && (
        <Link
          to="#"
          onClick={(event) => {
            event.preventDefault();
            void assignments.fetchNextPage();
          }}
        >
          {t('designer.workspace.loadMore')}
        </Link>
      )}
    </section>
  );
}
