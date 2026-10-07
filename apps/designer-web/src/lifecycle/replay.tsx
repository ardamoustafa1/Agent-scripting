import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';

import { Alert, Badge, Select } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { Failure, Loading } from '../workspace/states.js';

import './styles.css';

const Version = z.object({ id: z.uuid() });
const Sessions = z.object({
  data: z.array(z.object({ id: z.uuid(), state: z.string(), startedAt: z.string() })),
});
const Step = z.discriminatedUnion('kind', [
  z.object({
    seq: z.number(),
    atMs: z.number(),
    kind: z.literal('page'),
    pageId: z.string(),
    pageName: z.string().nullable(),
  }),
  z.object({
    seq: z.number(),
    atMs: z.number(),
    kind: z.literal('field'),
    variable: z.string(),
    value: z.string(),
  }),
  z.object({
    seq: z.number(),
    atMs: z.number(),
    kind: z.literal('state'),
    from: z.string(),
    to: z.string(),
  }),
  z.object({ seq: z.number(), atMs: z.number(), kind: z.literal('timer'), timerId: z.string() }),
  z.object({ seq: z.number(), atMs: z.number(), kind: z.literal('other'), type: z.string() }),
]);
const Replay = z.object({
  sessionId: z.uuid(),
  state: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  steps: z.array(Step),
  pages: z.array(
    z.object({ pageId: z.string(), name: z.string(), visits: z.number(), dwellMs: z.number() }),
  ),
  unreached: z.array(z.object({ id: z.string(), name: z.string() })),
  truncated: z.boolean(),
});

/** m:ss, or h:mm:ss from an hour on. */
export function formatOffset(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** Path replay of a real session over this version (ADR-0050, metadata only; every read is audited). */
export default function ReplayPage() {
  const { id = '', number = '1' } = useParams(),
    { t } = useTranslation(),
    { session } = useWorkspace();
  const scope = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'replay',
    id,
    number,
  ];
  const [selected, setSelected] = useState('');
  const version = useQuery({
    queryKey: [...scope, 'version'],
    queryFn: ({ signal }) => request(`/v1/scripts/${id}/versions/${number}`, Version, { signal }),
  });
  const sessions = useQuery({
    queryKey: [...scope, 'sessions', version.data?.id],
    enabled: !!version.data,
    queryFn: ({ signal }) =>
      request(`/v1/sessions?scriptVersionId=${version.data?.id ?? ''}&limit=50`, Sessions, {
        signal,
      }),
  });
  const replay = useQuery({
    queryKey: [...scope, 'session', selected],
    enabled: selected !== '',
    queryFn: ({ signal }) => request(`/v1/sessions/${selected}/replay`, Replay, { signal }),
  });
  const data = replay.data;
  return (
    <section className="lc-replay" aria-labelledby="replay-title">
      <Link className="dw-back" to={`/scripts/${id}`}>
        <ArrowLeft size={16} aria-hidden /> {t('designer.workspace.back')}
      </Link>
      <h1 id="replay-title">{t('designer.replay.title', { number })}</h1>
      <Alert tone="info" title={t('designer.replay.watermark')} />
      {(version.isError || sessions.isError) && (
        <Failure
          error={version.error ?? sessions.error}
          retry={() => {
            void version.refetch();
            void sessions.refetch();
          }}
        />
      )}
      {sessions.isPending && <Loading />}
      {sessions.data?.data.length === 0 && <p>{t('designer.replay.empty')}</p>}
      {!!sessions.data?.data.length && (
        <Select
          label={t('designer.replay.session')}
          value={selected}
          options={sessions.data.data.map((row) => ({
            value: row.id,
            label: `${new Date(row.startedAt).toLocaleString()} · ${t(`designer.replay.state.${row.state}`, { defaultValue: row.state })}`,
          }))}
          onValueChange={setSelected}
        />
      )}
      {replay.isPending && selected !== '' && <Loading />}
      {replay.isError && <Failure error={replay.error} retry={() => void replay.refetch()} />}
      {data && (
        <>
          <p>
            <Badge>{t(`designer.replay.state.${data.state}`, { defaultValue: data.state })}</Badge>{' '}
            {t('designer.replay.duration', { duration: formatOffset(data.durationMs) })}
          </p>
          {data.truncated && <Alert tone="warning" title={t('designer.replay.truncated')} />}
          <h2>{t('designer.replay.pages')}</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('designer.replay.page')}</th>
                <th scope="col">{t('designer.replay.visits')}</th>
                <th scope="col">{t('designer.replay.dwell')}</th>
              </tr>
            </thead>
            <tbody>
              {data.pages.map((page) => (
                <tr key={page.pageId}>
                  <th scope="row">{page.name}</th>
                  <td>{page.visits}</td>
                  <td>{formatOffset(page.dwellMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.unreached.length > 0 && (
            <p>
              {t('designer.replay.unreached')}: {data.unreached.map((page) => page.name).join(', ')}
            </p>
          )}
          <h2>{t('designer.replay.timeline')}</h2>
          <ol className="lc-replay-steps">
            {data.steps.map((step) => (
              <li key={step.seq}>
                <time>{formatOffset(step.atMs)}</time>{' '}
                {step.kind === 'page' &&
                  t('designer.replay.step.page', { name: step.pageName ?? step.pageId })}
                {step.kind === 'field' &&
                  t('designer.replay.step.field', { variable: step.variable, value: step.value })}
                {step.kind === 'state' &&
                  t('designer.replay.step.state', { from: step.from, to: step.to })}
                {step.kind === 'timer' && t('designer.replay.step.timer', { timer: step.timerId })}
                {step.kind === 'other' && t('designer.replay.step.other', { type: step.type })}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
