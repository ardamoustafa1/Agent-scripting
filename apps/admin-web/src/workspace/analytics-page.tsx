import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  AnalyticsDashboardSchema,
  AnalyticsScheduleSchema,
  AnalyticsFilterSchema,
} from '@verbis/shared-types';
import { AnalyticsDashboard, defaultAnalyticsFilter } from '@verbis/ui';

import { useCan } from './access.js';
import { ListSchema, request, text, useAdmin, type Row } from './api.js';

const ScheduleList = z.array(
  z.object({ id: z.uuid(), next_run_at: z.string(), version: z.number() }),
);
const named = (rows: readonly Row[] | undefined, ...keys: string[]) =>
  rows?.map((row) => ({
    value: row.id,
    label: keys.map((key) => text(row, key)).find(Boolean) ?? row.id,
  }));
export default function AnalyticsPage() {
  const session = useAdmin(),
    can = useCan(),
    canExport = can('export', 'Report'),
    canManage = can('manage', 'Report');
  const [filter, setFilter] = useState(defaultAnalyticsFilter),
    client = useQueryClient();
  const scope = ['analytics', session.user.tenantId, session.user.id],
    valid = AnalyticsFilterSchema.safeParse(filter).success;
  const search = new URLSearchParams(
    Object.entries(filter).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  ).toString();
  const query = useQuery({
    queryKey: [...scope, search],
    queryFn: ({ signal }) =>
      request('/v1/analytics/dashboard?' + search, AnalyticsDashboardSchema, { signal }),
    enabled: valid,
    refetchInterval: 10000,
    retry: false,
  });
  const { t } = useTranslation();
  const recommendations = useQuery({
    queryKey: [...scope, 'recommendations', search],
    queryFn: ({ signal }) =>
      request(
        '/v1/analytics/recommendations?' + search,
        z.object({
          data: z.array(
            z.object({
              experimentId: z.string(),
              recommended: z.string().nullable(),
              reason: z.string(),
            }),
          ),
        }),
        { signal },
      ),
    enabled: valid,
    retry: false,
  });
  // U-05/D-17: names for campaign/team filters and recipients, searched on the server (?q=).
  const [terms, setTerms] = useState({ campaign: '', team: '', recipient: '' }),
    [applied, setApplied] = useState(terms),
    [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(terms);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [terms]);
  const withQ = (path: string, q: string) =>
    q.trim() ? `${path}&q=${encodeURIComponent(q.trim())}` : path;
  const lookup = (path: string, enabled = true) => ({
    queryKey: [...scope, 'lookup', path],
    queryFn: ({ signal }: { signal: AbortSignal }) => request(path, ListSchema, { signal }),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const campaigns = useQuery(lookup(withQ('/v1/campaigns?limit=100', applied.campaign))),
    teams = useQuery(lookup(withQ('/v1/groups?limit=100&sort=displayName', applied.team))),
    users = useQuery(lookup(withQ('/v1/users?limit=100', applied.recipient), canManage));
  const rememberOptions = () => {
    const options = [
      ...(named(campaigns.data?.data, 'name') ?? []),
      ...(named(teams.data?.data, 'displayName') ?? []),
    ];
    setSeen((previous) => ({
      ...previous,
      ...Object.fromEntries(options.map((option) => [option.value, option.label])),
    }));
  };
  // Keep the chosen campaign/team selectable while a search narrows the list.
  const options = (
    rows: readonly Row[] | undefined,
    selected: string | undefined,
    ...keys: string[]
  ) => {
    const list = named(rows, ...keys) ?? [];
    return selected && !list.some((option) => option.value === selected)
      ? [{ value: selected, label: seen[selected] ?? selected }, ...list]
      : list;
  };
  const schedules = useQuery({
    queryKey: [...scope, 'schedules'],
    queryFn: ({ signal }) => request('/v1/analytics/schedules', ScheduleList, { signal }),
    enabled: canManage,
    retry: false,
  });
  return (
    <>
      <AnalyticsDashboard
        filter={filter}
        onFilter={(next) => {
          rememberOptions();
          setFilter(next);
        }}
        campaignOptions={options(campaigns.data?.data, filter.campaignId, 'name')}
        teamOptions={options(teams.data?.data, filter.teamId, 'displayName')}
        onOptionSearch={(kind, q) => {
          rememberOptions();
          setTerms((current) => ({ ...current, [kind]: q }));
        }}
        data={valid ? query.data : undefined}
        loading={valid && query.isPending}
        error={!valid || query.isError}
        onRetry={() => {
          void query.refetch();
        }}
        {...(canExport
          ? {
              onExport: async (format: 'csv' | 'xlsx') => {
                const response = await fetch('/api/v1/analytics/export/' + format + '?' + search, {
                  credentials: 'same-origin',
                  cache: 'no-store',
                });
                if (!response.ok) throw new Error('Export failed');
                const url = URL.createObjectURL(await response.blob()),
                  a = document.createElement('a');
                a.href = url;
                a.download = 'verbis-analytics.' + format;
                a.click();
                setTimeout(() => {
                  URL.revokeObjectURL(url);
                }, 1000);
              },
            }
          : {})}
        {...(canManage
          ? {
              schedules: schedules.data?.map((s) => ({ id: s.id, nextRunAt: s.next_run_at })),
              recipientOptions: named(users.data?.data, 'displayName', 'email'),
              onSchedule: async (input: z.infer<typeof AnalyticsScheduleSchema>) => {
                await request(
                  '/v1/analytics/schedules',
                  z.object({ id: z.uuid(), nextRunAt: z.string() }),
                  {
                    method: 'POST',
                    body: AnalyticsScheduleSchema.parse(input),
                    csrf: session.csrfToken,
                  },
                );
                await client.invalidateQueries({ queryKey: [...scope, 'schedules'] });
              },
              onDeleteSchedule: async (id: string) => {
                await request('/v1/analytics/schedules/' + id, z.object({ deleted: z.boolean() }), {
                  method: 'DELETE',
                  csrf: session.csrfToken,
                });
                await client.invalidateQueries({ queryKey: [...scope, 'schedules'] });
              },
            }
          : {})}
      />
      <section aria-label={t('analytics.recommendations.title')}>
        <h2>{t('analytics.recommendations.title')}</h2>
        <p>{t('analytics.recommendations.help')}</p>
        {recommendations.isError && <p role="alert">{t('analytics.error')}</p>}
        {recommendations.data?.data.map((row) => (
          <p key={row.experimentId}>
            {row.experimentId}:{' '}
            {row.recommended
              ? t('analytics.recommendations.winner', { name: row.recommended })
              : t(`analytics.recommendations.${row.reason}`)}
          </p>
        ))}
      </section>
    </>
  );
}
