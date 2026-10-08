import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { DataTable, StatusBadge, type Status } from '@verbis/ui';

import { useResource } from './api.js';
import { Card, Feedback, useEnumLabel, useLabels } from './widgets.js';

const Ready = z.looseObject({
  status: z.string(),
  service: z.string().optional(),
  version: z.string().optional(),
  checks: z.record(z.string(), z.looseObject({ status: z.string() })).default({}),
});
const Counts = z.object({
  data: z.array(z.object({ eventType: z.string(), day: z.string(), count: z.number() })),
});
type Count = z.infer<typeof Counts>['data'][number];

const toStatus = (value: string): Status =>
  value === 'up' || value === 'ok'
    ? 'up'
    : value === 'down' || value === 'error'
      ? 'down'
      : 'unknown';

/** Readiness of each dependency as a labelled status list instead of a raw JSON dump. */
export function ReadinessChecks() {
  const l = useLabels(),
    { t, i18n } = useTranslation(),
    ready = useResource('/health/ready', Ready, true);
  const checks = Object.entries(ready.data?.checks ?? {});
  const name = (key: string) => {
    const path = `adminWorkspace.ops.check.${key}`;
    return i18n.exists(path) ? t(path) : key;
  };
  return (
    <>
      <Feedback error={ready.error} />
      {ready.data ? (
        <>
          <p>
            <StatusBadge
              status={toStatus(ready.data.status)}
              label={l('ops.overall')}
              statusText={t(`adminWorkspace.ops.state.${toStatus(ready.data.status)}`)}
            />
            {ready.data.version
              ? ` · ${t('adminWorkspace.ops.version', { version: ready.data.version })}`
              : ''}
          </p>
          <ul className="aw-checks">
            {checks.map(([key, check]) => (
              <li key={key}>
                <StatusBadge
                  status={toStatus(check.status)}
                  label={name(key)}
                  statusText={t(`adminWorkspace.ops.state.${toStatus(check.status)}`)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** Domain events processed per day (fed by the event consumer): a quick sign the pipeline moves. */
export function EventFlow() {
  const l = useLabels(),
    { i18n } = useTranslation(),
    query = useResource('/v1/analytics/event-counts', Counts, true),
    day = (value: string) =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(value));
  const rows = [...(query.data?.data ?? [])].sort(
    (a, b) => b.day.localeCompare(a.day) || a.eventType.localeCompare(b.eventType),
  );
  return (
    <Card title={l('ops.eventsTitle')}>
      <p>{l('ops.eventsHint')}</p>
      <Feedback error={query.error} />
      {query.isPending ? <p>{l('loading')}</p> : null}
      {query.data && rows.length === 0 ? <p>{l('ops.eventsNone')}</p> : null}
      {rows.length > 0 ? (
        <DataTable
          label={l('ops.eventsTitle')}
          data={rows}
          getRowId={(row: Count) => `${row.day}-${row.eventType}`}
          columns={[
            {
              id: 'day',
              header: l('ops.day'),
              accessor: (row: Count) => row.day,
              cell: (row: Count) => day(row.day),
            },
            {
              id: 'eventType',
              header: l('ops.eventType'),
              accessor: (row: Count) => row.eventType,
              cell: (row: Count) => <code>{row.eventType}</code>,
            },
            { id: 'count', header: l('ops.count'), accessor: (row: Count) => String(row.count) },
          ]}
        />
      ) : null}
    </Card>
  );
}

const Channels = z.object({
  data: z.array(
    z.looseObject({ id: z.string(), type: z.string(), provider: z.string().nullable().optional() }),
  ),
});
type Channel = z.infer<typeof Channels>['data'][number];

/** The channel types (voice, chat, e-mail …) and providers the tenant has configured. */
export function ChannelList() {
  const l = useLabels(),
    enumLabel = useEnumLabel(),
    query = useResource('/v1/channels?limit=100', Channels);
  const rows = query.data?.data ?? [];
  return (
    <Card title={l('ops.channelsTitle')}>
      <p>{l('ops.channelsHint')}</p>
      <Feedback error={query.error} />
      {query.isPending ? <p>{l('loading')}</p> : null}
      {query.data && rows.length === 0 ? <p>{l('ops.channelsNone')}</p> : null}
      {rows.length > 0 ? (
        <DataTable
          label={l('ops.channelsTitle')}
          data={rows}
          getRowId={(row: Channel) => row.id}
          columns={[
            {
              id: 'type',
              header: l('ops.channelType'),
              accessor: (row: Channel) => enumLabel('channelType', row.type),
            },
            {
              id: 'provider',
              header: l('ops.channelProvider'),
              accessor: (row: Channel) => row.provider ?? l('ops.noProvider'),
            },
          ]}
        />
      ) : null}
    </Card>
  );
}
