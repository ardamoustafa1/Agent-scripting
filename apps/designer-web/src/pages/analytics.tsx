import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import {
  AnalyticsDashboardSchema,
  AnalyticsScheduleSchema,
  AnalyticsFilterSchema,
} from '@verbis/shared-types';
import { AnalyticsDashboard, defaultAnalyticsFilter } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const ScheduleList = z.array(
  z.object({ id: z.uuid(), next_run_at: z.string(), version: z.number() }),
);
export default function AnalyticsPage() {
  const { session, environment } = useWorkspace(),
    ability = useAbility(),
    canExport = ability.can('export', 'Report'),
    canManage = ability.can('manage', 'Report');
  const [filter, setFilter] = useState(defaultAnalyticsFilter),
    client = useQueryClient();
  const scope = ['analytics', session.user.tenantId, session.user.id, environment],
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
  const schedules = useQuery({
    queryKey: [...scope, 'schedules'],
    queryFn: ({ signal }) => request('/v1/analytics/schedules', ScheduleList, { signal }),
    enabled: canManage,
    retry: false,
  });
  return (
    <AnalyticsDashboard
      filter={filter}
      onFilter={setFilter}
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
  );
}
