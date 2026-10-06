import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Badge, Alert } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const Impact = z.object({
  hiddenCampaignCount: z.int().nonnegative().default(0),
  affected: z.array(
    z.object({
      scriptId: z.uuid(),
      scriptName: z.string(),
      versionNumber: z.number().int(),
      outdated: z.boolean(),
    }),
  ),
});
const Assignments = z.object({
  data: z.array(z.object({ campaignId: z.uuid() })),
  page: z.object({ nextCursor: z.string().nullable() }),
});
export function LinkedScreens({ ids }: { ids: readonly string[] }) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace(),
    ability = useAbility();
  const scope = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    environment,
    'editor-links',
  ];
  const impacts = useQueries({
    queries: ids.map((id) => ({
      queryKey: [...scope, 'impact', id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request(`/v1/shared-screens/${id}/impact`, Impact, { signal }),
      enabled: ability.can('read', 'Screen'),
    })),
  });
  const scripts = [
    ...new Set(impacts.flatMap((query) => query.data?.affected.map((s) => s.scriptId) ?? [])),
  ];
  const campaigns = useQueries({
    queries: scripts.map((id) => ({
      queryKey: [...scope, 'campaigns', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const ids = new Set<string>();
        let cursor: string | null = null;
        do {
          const params = new URLSearchParams({ scriptId: id, limit: '100' });
          if (cursor) params.set('cursor', cursor);
          const page = await request(`/v1/assignments?${params.toString()}`, Assignments, {
            signal,
          });
          page.data.forEach((a) => ids.add(a.campaignId));
          cursor = page.page.nextCursor;
        } while (cursor);
        return [...ids];
      },
      enabled: ability.can('read', 'Campaign'),
    })),
  });
  const campaignIds = [...new Set(campaigns.flatMap((q) => q.data ?? []))];
  const names = useQueries({
    queries: campaignIds.map((id) => ({
      queryKey: [...scope, 'campaign', id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request(`/v1/campaigns/${id}`, z.object({ name: z.string() }), { signal }),
    })),
  });
  if (!ids.length) return null;
  return (
    <section className="ed-linked">
      <Badge>{t('designer.editor.linked')}</Badge>
      <p>{t('designer.editor.linkedReadonly')}</p>
      {impacts.map((q, index) => (
        <div key={ids[index]}>
          {Boolean(q.data?.hiddenCampaignCount) && (
            <p>{t('designer.editor.hiddenCampaigns', { count: q.data?.hiddenCampaignCount })}</p>
          )}
          {q.isError ? (
            <Alert title={t('designer.editor.impactUnavailable')} tone="warning" />
          ) : q.isPending ? (
            <p>{t('designer.editor.loading')}</p>
          ) : (
            q.data.affected.map((s) => (
              <p key={`${s.scriptId}-${s.versionNumber}`}>
                {t('designer.editor.affectedVersion', {
                  name: s.scriptName,
                  version: s.versionNumber,
                })}
                {s.outdated && <Badge tone="warning">{t('designer.editor.outdated')}</Badge>}
              </p>
            ))
          )}
        </div>
      ))}
      {names.map((q, index) => (
        <p key={campaignIds[index]}>{q.data?.name ?? t('designer.editor.loading')}</p>
      ))}
      {(campaigns.some((q) => q.isError) || names.some((q) => q.isError)) && (
        <Alert title={t('designer.editor.impactUnavailable')} tone="warning" />
      )}
    </section>
  );
}
