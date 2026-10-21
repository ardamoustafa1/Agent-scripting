import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Alert, Badge } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const Allocation = z.object({
  allocation: z.object({
    reason: z.enum(['ok', 'insufficient-sessions', 'no-eligible-arm']),
    arms: z.array(z.object({ key: z.string(), probabilityBest: z.number(), weight: z.number() })),
  }),
});
const Rollout = z.object({
  stableSessions: z.number(),
  canarySessions: z.number(),
  windowDays: z.number(),
  decision: z.object({
    action: z.enum(['none', 'hold', 'advance', 'rollback']),
    reason: z.enum([
      'not-a-rollout',
      'not-started',
      'complete',
      'guardrail-breached',
      'completion-dropped',
      'insufficient-sessions',
      'no-harm-detected',
    ]),
    breached: z.array(z.string()),
    from: z.number().nullable(),
    to: z.number().nullable(),
    proposal: z.array(z.object({ key: z.string(), weight: z.number() })).optional(),
  }),
});
const Conflicts = z.array(
  z.object({
    assignmentIds: z.array(z.string()),
    priority: z.number(),
    severity: z.enum(['certain', 'possible']),
    resolvedBy: z.enum(['specificity', 'recency', 'id']),
    overlap: z.record(z.string(), z.unknown()),
  }),
);

const percent = (basisPoints: number) => `${String(Math.round(basisPoints) / 100)}%`;
const share = (probability: number) => `${String(Math.round(probability * 1000) / 10)}%`;
const DIMENSIONS = ['channels', 'locales', 'queues', 'skills', 'segments'];

/** Read-only evidence for an A/B or canary assignment: who is winning and what the rollout would do next. */
export function VariantInsights({ assignmentId }: { assignmentId: string }) {
  const { t } = useTranslation(),
    { session } = useWorkspace();
  const key = ['workspace', session.user.tenantId, session.user.id, session.session.id];
  const allocation = useQuery({
    queryKey: [...key, 'allocation', assignmentId],
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      request(`/v1/assignments/${assignmentId}/allocation`, Allocation, { signal }),
  });
  const rollout = useQuery({
    queryKey: [...key, 'rollout', assignmentId],
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      request(`/v1/assignments/${assignmentId}/rollout`, Rollout, { signal }),
  });
  const arm = (armKey: string) =>
    t('designer.lifecycle.insights.arm', { key: armKey.toUpperCase() });
  const verdict = rollout.data?.decision;
  return (
    <section className="lc-insights" aria-labelledby="lc-insights-title">
      <h3 id="lc-insights-title">{t('designer.lifecycle.insights.title')}</h3>
      <p>{t('designer.lifecycle.insights.help')}</p>
      {allocation.isError || rollout.isError ? (
        <Alert tone="danger" title={t('designer.lifecycle.insights.failed')} />
      ) : !allocation.data || !rollout.data ? (
        <p aria-busy="true">{t('designer.lifecycle.insights.loading')}</p>
      ) : (
        <>
          <h4>{t('designer.lifecycle.insights.allocation')}</h4>
          {allocation.data.allocation.reason === 'ok' ? (
            <table className="lc-table">
              <thead>
                <tr>
                  <th scope="col">{t('designer.lifecycle.insights.armColumn')}</th>
                  <th scope="col">{t('designer.lifecycle.insights.current')}</th>
                  <th scope="col">{t('designer.lifecycle.insights.best')}</th>
                </tr>
              </thead>
              <tbody>
                {allocation.data.allocation.arms.map((a) => (
                  <tr key={a.key}>
                    <th scope="row">{arm(a.key)}</th>
                    <td>{percent(a.weight)}</td>
                    <td>{share(a.probabilityBest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Alert
              tone={allocation.data.allocation.reason === 'no-eligible-arm' ? 'warning' : 'info'}
              title={t(
                `designer.lifecycle.insights.allocationReason.${allocation.data.allocation.reason}`,
              )}
            />
          )}
          <h4>{t('designer.lifecycle.insights.rollout')}</h4>
          {verdict && (
            <Alert
              tone={
                verdict.action === 'rollback'
                  ? 'danger'
                  : verdict.action === 'advance'
                    ? 'success'
                    : verdict.action === 'hold'
                      ? 'warning'
                      : 'info'
              }
              title={t(`designer.lifecycle.insights.action.${verdict.action}`)}
            >
              {t(`designer.lifecycle.insights.reason.${verdict.reason}`)}
            </Alert>
          )}
          {verdict && verdict.action !== 'none' && (
            <p>
              {t('designer.lifecycle.insights.sessions', {
                stable: rollout.data.stableSessions,
                canary: rollout.data.canarySessions,
                days: rollout.data.windowDays,
              })}
            </p>
          )}
          {verdict && verdict.breached.length > 0 && (
            <p>
              {t('designer.lifecycle.insights.breached')}: {verdict.breached.join(', ')}
            </p>
          )}
          {verdict?.proposal && verdict.proposal.length > 0 && (
            <p>
              {t('designer.lifecycle.insights.proposal')}:{' '}
              {verdict.proposal.map((p) => `${arm(p.key)} ${percent(p.weight)}`).join(' / ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Equal-priority assignments of one campaign whose contexts overlap, and which one wins. */
export function ConflictList({
  campaignId,
  nameOf,
}: {
  campaignId: string;
  nameOf: (assignmentId: string) => string;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace();
  const conflicts = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'assignment-conflicts',
      campaignId,
    ],
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      request(`/v1/campaigns/${campaignId}/assignment-conflicts`, Conflicts, { signal }),
  });
  return (
    <article className="lc-card">
      <h2>{t('designer.lifecycle.conflicts.title')}</h2>
      <p>{t('designer.lifecycle.conflicts.help')}</p>
      {conflicts.isError ? (
        <Alert tone="danger" title={t('designer.lifecycle.conflicts.failed')} />
      ) : !conflicts.data ? (
        <p aria-busy="true">{t('designer.lifecycle.insights.loading')}</p>
      ) : conflicts.data.length === 0 ? (
        <Alert tone="success" title={t('designer.lifecycle.conflicts.none')} />
      ) : (
        <ul className="lc-conflicts">
          {conflicts.data.map((c) => (
            <li key={c.assignmentIds.join('|')}>
              <p>
                <Badge>{t(`designer.lifecycle.conflicts.severity.${c.severity}`)}</Badge>{' '}
                <strong>{c.assignmentIds.map(nameOf).join(' ↔ ')}</strong>
              </p>
              <p>
                {t('designer.lifecycle.conflicts.priority', { priority: c.priority })} ·{' '}
                {t(`designer.lifecycle.conflicts.resolvedBy.${c.resolvedBy}`)}
              </p>
              {Object.keys(c.overlap).length > 0 && (
                <p>
                  {t('designer.lifecycle.conflicts.overlap')}:{' '}
                  {Object.entries(c.overlap)
                    .map(([dimension, value]) => overlapText(dimension, value, t))
                    .join('; ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** "Channel: Voice, Chat" — dimension and values in the author's language. */
function overlapText(
  dimension: string,
  value: unknown,
  t: (key: string, options: Record<string, unknown>) => string,
): string {
  const label = DIMENSIONS.includes(dimension)
    ? t(`designer.lifecycle.conflicts.dimensions.${dimension}`, {})
    : dimension;
  const values = Array.isArray(value)
    ? value
        .map((item: unknown) => {
          const text = typeof item === 'string' || typeof item === 'number' ? String(item) : '';
          if (dimension === 'channels')
            return t(`designer.preview.channels.${text}`, { defaultValue: text });
          if (dimension === 'locales') return t(`common.locale.${text}`, { defaultValue: text });
          return text;
        })
        .filter(Boolean)
        .join(', ')
    : t('designer.lifecycle.conflicts.anyValue', {});
  return `${label}: ${values}`;
}
