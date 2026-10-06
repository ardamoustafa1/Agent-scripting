import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { RegressionReportSchema } from '@verbis/shared-types';
import { Button, Alert, Badge, Textarea } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

import './regression.css';

interface RegressionPanelProps {
  scriptId: string;
  number: number;
  documentVersion?: number | undefined;
  state: string;
  dirty?: boolean;
  showHeading?: boolean;
}
export function RegressionPanel(props: RegressionPanelProps) {
  // A changed saved document or edit state starts a fresh acceptance session.
  return (
    <RegressionPanelContent
      key={`${props.scriptId}:${props.number}:${props.documentVersion ?? 'unknown'}:${Boolean(props.dirty)}`}
      {...props}
    />
  );
}
function RegressionPanelContent({
  scriptId,
  number,
  documentVersion,
  state,
  dirty = false,
  showHeading = true,
}: RegressionPanelProps) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient();
  const [report, setReport] = useState<z.infer<typeof RegressionReportSchema> | null>(null);
  const generation = useRef(0);
  const identity = `${scriptId}:${number}:${documentVersion ?? 'unknown'}`;
  const [reportIdentity, setReportIdentity] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [comment, setComment] = useState(''),
    [done, setDone] = useState(false);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const scope = lifetime.current;
    scope.active = true;
    return () => {
      scope.active = false;
    };
  }, []);
  const perform = async (action: 'regression' | 'reviews' | 'publish') => {
    if (dirty || busy) return;
    const ticket = ++generation.current;
    const scope = lifetime.current;
    setBusy(true);
    setError(false);
    if (action === 'regression') setReport(null);
    try {
      const path = `/v1/scripts/${scriptId}/versions/${number}/${action}`;
      if (action === 'regression') {
        const result = await request(path, RegressionReportSchema, {
          method: 'POST',
          csrf: session.csrfToken,
        });
        if (!scope.active || ticket !== generation.current) return;
        setReportIdentity(identity);
        setReport(result);
      } else {
        await request(path, z.unknown(), {
          method: 'POST',
          csrf: session.csrfToken,
          ...(action === 'reviews' ? { body: { decision: 'approved', comment } } : {}),
        });
        if (!scope.active || ticket !== generation.current) return;
        setDone(true);
        await client.invalidateQueries({ queryKey: ['workspace'] });
      }
    } catch {
      if (scope.active && ticket === generation.current) setError(true);
    } finally {
      if (scope.active && ticket === generation.current) setBusy(false);
    }
  };
  const validReport =
    !dirty &&
    reportIdentity === identity &&
    (documentVersion === undefined || report?.version === documentVersion) &&
    (report?.results.length ?? 0) > 0 &&
    report?.passed;
  return (
    <section className="pv-panel pv-regression" aria-label={t('designer.preview.regression')}>
      {showHeading && <h3>{t('designer.preview.regression')}</h3>}
      <p>{t('designer.preview.regressionHelp')}</p>
      <Button
        loading={busy}
        disabled={dirty}
        onClick={() => {
          void perform('regression');
        }}
      >
        {t('designer.preview.runScenarios')}
      </Button>
      {dirty && <Alert title={t('designer.preview.saveFirst')} tone="warning" />}
      {error && <Alert title={t('designer.preview.failed')} tone="danger" />}
      {report && documentVersion !== undefined && report.version !== documentVersion && (
        <Alert title={t('designer.preview.staleReport')} tone="warning" />
      )}
      {report && (
        <>
          {report.results.length === 0 && (
            <Alert tone="warning" title={t('designer.preview.scenariosRequired')} />
          )}
          <p role="status">
            <Badge tone={report.passed && report.results.length > 0 ? 'success' : 'danger'}>
              {t(
                report.passed && report.results.length > 0
                  ? 'designer.preview.passed'
                  : 'designer.preview.failed',
              )}
            </Badge>{' '}
            {report.results.length} · {report.checkedAt}
          </p>
          <code>{report.checksum}</code>
          <ul>
            {report.results.map((result) => (
              <li key={result.id}>
                <Badge tone={result.passed ? 'success' : 'danger'}>
                  {t(result.passed ? 'designer.preview.passed' : 'designer.preview.failed')}
                </Badge>{' '}
                {result.id} · {result.durationMs} {t('designer.preview.milliseconds')} {result.code}
                <ul>
                  {result.assertions.map((a) => (
                    <li key={a.path}>
                      {a.path} ·{' '}
                      {t(a.passed ? 'designer.preview.passed' : 'designer.preview.failed')}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {state === 'in_review' && ability.can('approve', 'Script') && (
        <>
          <Textarea
            label={t('designer.preview.reviewComment')}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
            }}
          />
          <Button
            disabled={dirty || !validReport || done}
            loading={busy}
            onClick={() => {
              void perform('reviews');
            }}
          >
            {t('designer.preview.approve')}
          </Button>
        </>
      )}
      {state === 'approved' && ability.can('publish', 'Script') && (
        <Button
          disabled={dirty || !validReport || done}
          loading={busy}
          onClick={() => {
            void perform('publish');
          }}
        >
          {t('designer.preview.publish')}
        </Button>
      )}
      {done && <Alert title={t('designer.preview.lifecycleDone')} tone="success" />}
    </section>
  );
}
