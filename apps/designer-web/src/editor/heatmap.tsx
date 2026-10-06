import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAbility } from '@verbis/authz/react';
import { AnalyticsDashboardSchema, type AnalyticsDashboard } from '@verbis/shared-types';
import { Button, Alert, defaultAnalyticsFilter } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const NO_HEAT: AnalyticsDashboard['heatmap'] = [];
export const HeatmapContext = createContext<AnalyticsDashboard['heatmap']>(NO_HEAT);
export function useNodeHeat(nodeId: string) {
  return useContext(HeatmapContext).find((h) => h.nodeId === nodeId);
}
export function useHeatmap(scriptId: string, versionId: string, pageId: string) {
  const { session, environment } = useWorkspace(),
    ability = useAbility(),
    [enabled, setEnabled] = useState(false),
    { t } = useTranslation();
  const filter = { ...defaultAnalyticsFilter(), scriptId },
    canRead = ability.can('read', 'Report');
  const query = useQuery({
    queryKey: [
      'heatmap',
      session.user.tenantId,
      session.user.id,
      environment,
      scriptId,
      filter.from,
      filter.to,
    ],
    queryFn: ({ signal }) =>
      request(
        '/v1/analytics/dashboard?' +
          new URLSearchParams(
            Object.entries(filter).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
          ).toString(),
        AnalyticsDashboardSchema,
        { signal },
      ),
    enabled: enabled && canRead,
    refetchInterval: 30000,
    retry: false,
  });
  // P-16: rows feed a context read by every canvas node; keep the reference stable.
  const heatmap = query.data?.heatmap;
  const rows = useMemo(
    () =>
      enabled && heatmap
        ? heatmap.filter((h) => h.versionId === versionId && h.pageId === pageId)
        : NO_HEAT,
    [enabled, heatmap, versionId, pageId],
  );
  return {
    rows,
    control: canRead ? (
      <>
        <Button
          size="sm"
          variant={enabled ? 'primary' : 'secondary'}
          aria-pressed={enabled}
          onClick={() => {
            setEnabled((v) => !v);
          }}
        >
          {t('analytics.heatmap')}
        </Button>
        {enabled && query.isError && <Alert tone="warning" title={t('analytics.error')} />}
      </>
    ) : null,
  };
}
