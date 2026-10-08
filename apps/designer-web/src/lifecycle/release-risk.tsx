import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { dataMap, newDataFlows, type ScriptDocument } from '@verbis/script-schema';
import { Badge } from '@verbis/ui';

import { request } from '../api/client.js';
import { DataMapView, riskyDestination } from '../editor/data-map-view.js';
import { hygieneIssues, scriptHealth } from '../editor/health.js';
import { EditorStore, editorRegistry } from '../editor/store.js';
import { analyzeCoverage } from '../preview/coverage.js';
import { previewLint } from '../preview/lint.js';

import { releaseRisk, removedPages } from './risk.js';

const AssignmentPage = z.object({
  data: z.array(z.object({ campaignId: z.string() })),
  page: z.object({ nextCursor: z.string().nullable() }),
});
const ICONS = { low: ShieldCheck, medium: ShieldQuestion, high: ShieldAlert } as const;

/** Release risk card (DIFFERENTIATORS B5): explainable, advisory, next to the publication gate. */
export function ReleaseRisk({
  scriptId,
  queryKey,
  document,
  baseline,
  patch,
}: {
  scriptId: string;
  queryKey: readonly unknown[];
  document: ScriptDocument;
  baseline: ScriptDocument | undefined;
  patch: readonly { op: string; path: string }[] | undefined;
}) {
  const { t } = useTranslation();
  const health = useMemo(() => {
    const issues = [
      ...previewLint(document, new EditorStore(document).issues()),
      ...hygieneIssues(document),
    ];
    return scriptHealth(issues);
  }, [document]);
  const coverage = useQuery({
    queryKey: [...queryKey, 'coverage'],
    // Mock-only and local: the same engine as the regression suite, without a server call.
    queryFn: () => analyzeCoverage(document, editorRegistry),
    staleTime: Infinity,
  });
  const impact = useQuery({
    queryKey: [...queryKey, 'impact'],
    queryFn: ({ signal }) =>
      request(`/v1/assignments?scriptId=${scriptId}&limit=100`, AssignmentPage, { signal }),
    retry: false,
  });
  const flows = useMemo(() => {
    if (!baseline) return [];
    const after = dataMap(document);
    return newDataFlows(dataMap(baseline), after).map((flow) => {
      const entry = after.find((candidate) => candidate.variable === flow.variable);
      return { ...flow, risky: entry ? riskyDestination(entry, flow.destination) : false };
    });
  }, [document, baseline]);
  const reach = impact.data
    ? {
        assignments: impact.data.data.length,
        campaigns: new Set(impact.data.data.map((row) => row.campaignId)).size,
      }
    : null;
  const risk = releaseRisk({
    health,
    scenarios: document.testScenarios?.length ?? 0,
    coveragePercent: coverage.data?.percent ?? null,
    changes: patch?.length ?? 0,
    removedPages: removedPages(patch ?? []),
    newDataFlows: flows.length,
    riskyNewDataFlows: flows.filter((flow) => flow.risky).length,
    impact: reach,
  });
  const Icon = ICONS[risk.level];
  return (
    <article className="lc-card lc-risk" data-level={risk.level} aria-labelledby="lc-risk-title">
      <header className="lc-risk-header">
        <Icon size={28} aria-hidden />
        <div>
          <h2 id="lc-risk-title">{t('designer.risk.title')}</h2>
          <p>
            <Badge
              tone={
                risk.level === 'high' ? 'danger' : risk.level === 'medium' ? 'warning' : 'success'
              }
            >
              {t(`designer.risk.levels.${risk.level}`)}
            </Badge>{' '}
            {t('designer.risk.advisory')}
          </p>
        </div>
      </header>
      {risk.factors.length === 0 ? (
        <p>{t('designer.risk.none')}</p>
      ) : (
        <ul className="lc-risk-factors">
          {risk.factors.map(({ factor }) => (
            <li key={factor}>
              {t(`designer.risk.factors.${factor}`, {
                errors: health.errors,
                score: health.score,
                percent: coverage.data?.percent ?? 0,
                changes: patch?.length ?? 0,
                flows: flows.length,
                assignments: reach?.assignments ?? 0,
                campaigns: reach?.campaigns ?? 0,
              })}
            </li>
          ))}
        </ul>
      )}
      <dl className="lc-risk-facts">
        <div>
          <dt>{t('designer.risk.coverage')}</dt>
          <dd>
            {coverage.isPending
              ? t('designer.risk.measuring')
              : coverage.data?.percent === null || !coverage.data
                ? '—'
                : t('designer.risk.coverageValue', {
                    percent: coverage.data.percent,
                    covered: coverage.data.coveredEdges,
                    total: coverage.data.totalEdges,
                  })}
          </dd>
        </div>
        <div>
          <dt>{t('designer.risk.impact')}</dt>
          <dd>
            {reach
              ? t('designer.risk.impactValue', reach)
              : impact.isPending
                ? t('designer.risk.measuring')
                : t('designer.risk.impactUnknown')}
          </dd>
        </div>
      </dl>
      <details className="lc-risk-data">
        <summary>{t('designer.dataMap.title')}</summary>
        <DataMapView document={document} baseline={baseline} />
      </details>
    </article>
  );
}
