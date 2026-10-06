import { useState } from 'react';
import { z } from 'zod';

import { IntegrationSecretSetSchema } from '@verbis/shared-types';
import { Button, Badge } from '@verbis/ui';

import { AvayaRoutingSection } from '../avaya/avaya-routing-section.js';
import { AttachedDataSection } from '../engage/attached-data-section.js';
import { GenesysMappingSection } from '../genesys/genesys-mapping-section.js';
import { SimulatorSection } from '../simulator/simulator-section.js';

import { useCan } from './access.js';
import {
  RowSchema,
  RecordSchema,
  useResource,
  useWrite,
  record,
  text,
  csv,
  json,
  download,
  useAdmin,
  type Row,
} from './api.js';
import {
  Card,
  Field,
  SaveForm,
  ResourceList,
  Action,
  JsonView,
  DiffView,
  Feedback,
  Picker,
  useLabels,
} from './widgets.js';

export function Connectors() {
  const l = useLabels(),
    can = useCan(),
    session = useAdmin(),
    [selected, setSelected] = useState<Row | null>(null),
    [mappings, setMappings] = useState(false);
  return (
    <>
      <Card title={l('connectors')}>
        <ResourceList
          path="/v1/connectors"
          title={l('connectors')}
          columns={['platform', 'adapterType', 'status']}
          onSelect={setSelected}
          poll
        />
        <Button
          variant="ghost"
          onClick={() => {
            setSelected(null);
          }}
        >
          {l('create')}
        </Button>
      </Card>
      {selected ? <ConnectorDetail key={selected.id} id={selected.id} /> : <ConnectorEditor />}
      {can('update', 'User') ? <UserMapping /> : null}
      {can('read', 'Campaign') && can('update', 'Campaign') ? <QueueMapping /> : null}
      {can('manage', 'Connector') && can('update', 'Campaign') ? (
        <Card title={l('queueMappings')}>
          <Button
            variant="secondary"
            onClick={() => {
              setMappings(!mappings);
            }}
          >
            {l('queueMappings')}
          </Button>
          {mappings ? (
            <>
              <GenesysMappingSection csrfToken={session.csrfToken} />
              <AvayaRoutingSection csrfToken={session.csrfToken} />
              <AttachedDataSection csrfToken={session.csrfToken} />
            </>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
function ConnectorDetail({ id }: { id: string }) {
  const query = useResource(`/v1/admin/connectors/${id}`, RowSchema);
  return query.data ? (
    <ConnectorEditor key={query.data.version} row={query.data} />
  ) : (
    <Feedback error={query.error} />
  );
}
function ConnectorEditor({ row }: { row?: Row | undefined }) {
  const l = useLabels(),
    can = useCan(),
    write = useWrite(),
    [adapter, setAdapter] = useState(row ? text(row, 'adapterType') : 'generic'),
    [platform, setPlatform] = useState(row ? text(row, 'platform') : ''),
    [status, setStatus] = useState(row ? text(row, 'status') : 'draft'),
    [config, setConfig] = useState(JSON.stringify(row?.['config'] ?? {}, null, 2)),
    [refs, setRefs] = useState(z.array(z.string()).catch([]).parse(row?.['secretRefs']).join(',')),
    [health, setHealth] = useState<unknown>(row?.['health']),
    [debug, setDebug] = useState(false);
  return (
    <Card title={l('configuration')}>
      <SaveForm
        disabled={!can('manage', 'Connector')}
        onSave={() =>
          write(
            `/v1/admin/connectors${row ? `/${row.id}` : ''}`,
            { adapterType: adapter, platform, status, config: json(config), secretRefs: csv(refs) },
            row ? 'PUT' : 'POST',
            row?.version,
          )
        }
      >
        <Field
          label={l('adapterType')}
          value={adapter}
          onChange={setAdapter}
          options={[
            'generic',
            'genesys_cloud',
            'genesys_engage',
            'avaya_aes',
            'avaya_axp',
            'avaya_aacc',
            'amazon_connect',
            'cisco',
            'nice_cxone',
            'five9',
          ]}
        />
        <Field label={l('platform')} value={platform} onChange={setPlatform} required />
        <Field
          label={l('status')}
          value={status}
          onChange={setStatus}
          options={['draft', 'active', 'disabled']}
        />
        <Field label={l('configuration')} type="textarea" value={config} onChange={setConfig} />
        <Field label={l('secretRefs')} value={refs} onChange={setRefs} />
        <p>{l('referenceHint')}</p>
      </SaveForm>
      {row ? (
        <>
          <Action
            label={l('probe')}
            run={async () => {
              setHealth(await write(`/v1/admin/connectors/${row.id}/test`, {}));
            }}
          />
          <JsonView value={health} />
          {can('read', 'Audit') ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setDebug(!debug);
                }}
              >
                {l('liveEvents')}
              </Button>
              {debug ? (
                <ResourceList
                  path={`/v1/audit-events?resourceType=Connector&resourceId=${row.id}`}
                  title={l('liveEvents')}
                  columns={['occurredAt', 'action', 'outcome', 'correlationId']}
                  poll
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
function UserMapping() {
  const l = useLabels(),
    write = useWrite(),
    [user, setUser] = useState(''),
    [platform, setPlatform] = useState(''),
    [platformUser, setPlatformUser] = useState('');
  return (
    <Card title={l('userMapping')}>
      <SaveForm
        onSave={() =>
          write(
            `/v1/admin/users/${user}/connector-mapping`,
            { platform, platformUserId: platformUser },
            'PUT',
          )
        }
      >
        <Picker path="/v1/users" label={l('user')} value={user} onChange={setUser} />
        <Field label={l('platform')} value={platform} onChange={setPlatform} required />
        <Field
          label={l('platformUserId')}
          value={platformUser}
          onChange={setPlatformUser}
          required
        />
      </SaveForm>
    </Card>
  );
}
export function Secrets() {
  const l = useLabels(),
    can = useCan(),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <Card title={l('secrets')}>
        <p>{l('hiddenValues')}</p>
        <ResourceList
          path="/v1/secrets"
          title={l('secrets')}
          columns={['name', 'kind', 'rotatedAt', 'lastUsedAt', 'keyVersion']}
          onSelect={setSelected}
        />
        <Button
          variant="ghost"
          disabled={!can('create', 'Secret')}
          onClick={() => {
            setSelected(null);
          }}
        >
          {l('create')}
        </Button>
      </Card>
      <SecretEditor key={selected?.id ?? 'new'} row={selected ?? undefined} />
      {selected ? <SecretUsage id={selected.id} /> : null}
    </>
  );
}
function SecretEditor({ row }: { row?: Row | undefined }) {
  const l = useLabels(),
    can = useCan(),
    write = useWrite(),
    [name, setName] = useState(row ? text(row, 'name') : ''),
    [kind, setKind] = useState(row ? text(row, 'kind') : 'api_key'),
    [value, setValue] = useState('');
  return (
    <Card title={row ? l('rotate') : l('create')}>
      <SaveForm
        disabled={!can(row ? 'update' : 'create', 'Secret')}
        onSave={async () => {
          try {
            return await write(
              `/v1/secrets${row ? `/${row.id}` : ''}`,
              IntegrationSecretSetSchema.parse({ name, kind, value }),
              row ? 'PUT' : 'POST',
              row?.version,
            );
          } finally {
            setValue('');
          }
        }}
      >
        <Field label={l('name')} value={name} onChange={setName} required />
        <Field
          label={l('kind')}
          value={kind}
          onChange={setKind}
          options={['password', 'api_key', 'oauth_client', 'certificate', 'generic']}
        />
        <Field
          label={l('replaceSecret')}
          type="password"
          value={value}
          onChange={setValue}
          required
        />
      </SaveForm>
    </Card>
  );
}
function SecretUsage({ id }: { id: string }) {
  const l = useLabels(),
    can = useCan();
  return can('read', 'Integration') ? <Usage id={id} /> : <p>{l('denied')}</p>;
}
function Usage({ id }: { id: string }) {
  const l = useLabels(),
    query = useResource(
      `/v1/admin/secrets/${id}/usage`,
      z.object({ data: z.array(RowSchema), truncated: z.boolean() }),
    );
  return (
    <Card title={l('usedBy')}>
      <Feedback error={query.error} />
      {query.data?.data.map((row) => (
        <p key={row.id}>{text(row, 'key') || row.id}</p>
      ))}
    </Card>
  );
}
export function Audit() {
  const l = useLabels(),
    can = useCan(),
    write = useWrite(),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [applied, setApplied] = useState(''),
    [selected, setSelected] = useState<Row | null>(null),
    [report, setReport] = useState<unknown>(null),
    [fromSeq, setFromSeq] = useState(''),
    [toSeq, setToSeq] = useState('');
  function params(values: Record<string, string>) {
    const clean = Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
    for (const key of ['from', 'to'])
      if (clean[key]) clean[key] = new Date(clean[key]).toISOString();
    return new URLSearchParams(clean).toString();
  }
  return (
    <>
      <Card title={l('audit')}>
        <form
          className="aw-filter"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(params(filters));
          }}
        >
          {[
            'q',
            'action',
            'actorId',
            'resourceType',
            'resourceId',
            'outcome',
            'correlationId',
            'from',
            'to',
          ].map((key) => (
            <Field
              key={key}
              label={l(key)}
              type={key === 'from' || key === 'to' ? 'datetime-local' : 'text'}
              value={filters[key] ?? ''}
              onChange={(value) => {
                setFilters((current) => ({ ...current, [key]: value }));
              }}
            />
          ))}
          <Button type="submit">{l('filter')}</Button>
        </form>
        <ResourceList
          key={applied}
          path={`/v1/audit-events?${applied}`}
          title={l('audit')}
          columns={['occurredAt', 'seq', 'action', 'outcome', 'correlationId']}
          onSelect={setSelected}
        />
        <div className="aw-inline">
          {can('export', 'Audit')
            ? ['json', 'csv'].map((format) => (
                <Action
                  key={format}
                  label={`${l('export')} ${format.toUpperCase()}`}
                  run={() =>
                    download(
                      `/v1/audit-events/export?${applied}&format=${format}`,
                      `audit.${format}`,
                    )
                  }
                />
              ))
            : null}
        </div>
        {selected ? (
          <>
            <h3>{l('eventDetails')}</h3>
            <DiffView value={selected['diff']} />
            <JsonView value={selected} />
            <Button
              variant="secondary"
              onClick={() => {
                setApplied(
                  new URLSearchParams({
                    correlationId: text(selected, 'correlationId'),
                  }).toString(),
                );
              }}
            >
              {l('related')}
            </Button>
          </>
        ) : null}
      </Card>
      <Card title={l('verifyChain')}>
        <Field label={l('fromSeq')} value={fromSeq} onChange={setFromSeq} />
        <Field label={l('toSeq')} value={toSeq} onChange={setToSeq} />
        <Action
          label={l('verify')}
          run={async () => {
            setReport(
              await write('/v1/audit-events/verify', {
                ...(fromSeq ? { fromSeq } : {}),
                ...(toSeq ? { toSeq } : {}),
              }),
            );
          }}
        />
        {report ? (
          <>
            <p role="status">
              {record(report)['truncated']
                ? l('truncated')
                : record(report)['valid']
                  ? l('validChain')
                  : l('brokenChain')}
            </p>
            <JsonView value={report} />
          </>
        ) : null}
      </Card>
      {can('update', 'Tenant') ? <Siem /> : null}
    </>
  );
}
function Siem() {
  const l = useLabels(),
    write = useWrite(),
    [name, setName] = useState(''),
    [kind, setKind] = useState('webhook'),
    [endpoint, setEndpoint] = useState(''),
    [port, setPort] = useState('6514'),
    [secret, setSecret] = useState(''),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <Card title={l('siem')}>
      <ResourceList
        path="/v1/siem-destinations"
        title={l('siem')}
        columns={['name', 'kind', 'format']}
        onSelect={setSelected}
      />
      {selected ? (
        <>
          <JsonView value={selected['delivery']} />
          <Action
            label={l('toggleEnabled')}
            run={() =>
              write(
                `/v1/siem-destinations/${selected.id}`,
                { enabled: !selected['enabled'] },
                'PATCH',
                selected.version,
              ).then((result) => {
                setSelected(RowSchema.parse(result));
              })
            }
          />
          <Action
            key={`remove:${selected.id}:${selected.version}`}
            danger
            label={l('remove')}
            run={() =>
              write(
                `/v1/siem-destinations/${selected.id}`,
                undefined,
                'DELETE',
                selected.version,
              ).then(() => {
                setSelected(null);
              })
            }
          />
        </>
      ) : null}
      <SaveForm
        onSave={() =>
          write('/v1/siem-destinations', {
            name,
            kind,
            format: kind === 'syslog' ? 'rfc5424' : 'json',
            config:
              kind === 'syslog'
                ? { host: endpoint, port: Number(port) }
                : kind === 'webhook'
                  ? { url: endpoint }
                  : { topic: endpoint },
            ...(kind === 'webhook' ? { secretRef: `secret://${secret}` } : {}),
          })
        }
      >
        <Field label={l('name')} value={name} onChange={setName} required />
        <Field
          label={l('kind')}
          value={kind}
          onChange={setKind}
          options={['webhook', 'syslog', 'kafka']}
        />
        <Field
          label={kind === 'syslog' ? l('host') : kind === 'webhook' ? l('url') : l('topic')}
          value={endpoint}
          onChange={setEndpoint}
          required
        />
        {kind === 'syslog' ? (
          <Field label={l('port')} type="number" value={port} onChange={setPort} />
        ) : null}
        {kind === 'webhook' ? (
          <Field label={l('secretName')} value={secret} onChange={setSecret} required />
        ) : null}
      </SaveForm>
    </Card>
  );
}
export function Simulator() {
  const session = useAdmin();
  return <SimulatorSection csrfToken={session.csrfToken} />;
}
export function Health() {
  const l = useLabels(),
    can = useCan(),
    ready = useResource('/health/ready', RecordSchema, true);
  return (
    <>
      <Card title={l('systemHealth')}>
        <Feedback error={ready.error} />
        {ready.data ? <JsonView value={ready.data} /> : null}
        <p>{l('realMetrics')}</p>
        <ResourceList
          path="/v1/connectors"
          title={l('connectors')}
          columns={['platform', 'adapterType', 'status']}
          poll
        />
      </Card>
      {can('read', 'Audit') ? <OperationalMetrics /> : null}
      {can('manage', 'Outbox') ? <Outbox /> : null}
    </>
  );
}
function Outbox() {
  const l = useLabels(),
    write = useWrite(),
    query = useResource(
      '/v1/admin/outbox',
      z.object({
        pending: z.number(),
        published: z.number(),
        dead: z.number(),
        oldestPendingAt: z.string().nullable(),
        deadEvents: z.array(
          z.object({
            id: z.string(),
            eventType: z.string(),
            attempts: z.number(),
            lastError: z.string().nullable(),
          }),
        ),
      }),
      true,
    );
  return (
    <Card title={l('queues')}>
      <Feedback error={query.error} />
      {query.data ? (
        <>
          <div className="aw-stats">
            {['pending', 'published', 'dead'].map((key) => (
              <div key={key}>
                <span>{l(key)}</span>
                <strong>{text(record(query.data), key)}</strong>
              </div>
            ))}
          </div>
          <p>
            {l('oldestPendingAt')}: {query.data.oldestPendingAt ?? l('empty')}
          </p>
          {query.data.deadEvents.map((event) => (
            <div className="aw-inline" key={event.id}>
              <Badge tone="danger">{event.eventType}</Badge>
              <span>
                {event.attempts} · {event.lastError}
              </span>
              <Action
                label={l('requeue')}
                danger
                run={() => write(`/v1/admin/outbox/${event.id}/requeue`, {})}
              />
            </div>
          ))}
        </>
      ) : null}
    </Card>
  );
}

function OperationalMetrics() {
  const l = useLabels(),
    query = useResource(
      '/v1/admin/operations',
      z.object({
        windowHours: z.number(),
        total: z.number(),
        failed: z.number(),
        errorRate: z.number().nullable(),
      }),
      true,
    );
  return (
    <Card title={l('errorRate')}>
      <Feedback error={query.error} />
      {query.data ? (
        <p>
          {l('last24h')}:{' '}
          {query.data.errorRate === null
            ? l('noSamples')
            : `${(query.data.errorRate * 100).toFixed(1)}%`}{' '}
          · {query.data.failed} / {query.data.total}
        </p>
      ) : null}
    </Card>
  );
}
function QueueMapping() {
  const l = useLabels(),
    write = useWrite(),
    [campaign, setCampaign] = useState('');
  return (
    <Card title={l('queueMappings')}>
      <Picker path="/v1/campaigns" label={l('campaign')} value={campaign} onChange={setCampaign} />
      {campaign ? <CampaignMapping key={campaign} id={campaign} write={write} /> : null}
    </Card>
  );
}
function CampaignMapping({ id, write }: { id: string; write: ReturnType<typeof useWrite> }) {
  const l = useLabels(),
    query = useResource(`/v1/campaigns/${id}`, RowSchema),
    [platform, setPlatform] = useState('amazon-connect'),
    [kind, setKind] = useState('queue'),
    [externalId, setExternalId] = useState('');
  const schema = z.array(
    z.object({ platform: z.string(), kind: z.string(), externalId: z.string() }),
  );
  const rows = schema.parse(query.data?.['externalMappings'] ?? []);
  return (
    <>
      <Feedback error={query.error} />
      <SaveForm
        disabled={!query.data}
        onSave={() =>
          write(
            `/v1/campaigns/${id}`,
            {
              externalMappings: [
                ...rows.filter(
                  (row) =>
                    !(
                      row.platform === platform &&
                      row.kind === kind &&
                      row.externalId === externalId
                    ),
                ),
                { platform, kind, externalId },
              ],
            },
            'PATCH',
            query.data?.version,
          )
        }
      >
        <Field
          label={l('platform')}
          value={platform}
          onChange={setPlatform}
          options={[
            'amazon-connect',
            'cisco',
            'nice-cxone',
            'five9',
            'generic',
            'genesys-cloud',
            'genesys-engage',
            'avaya-aes',
            'avaya-axp',
            'avaya-aacc',
          ]}
        />
        <Field
          label={l('kind')}
          value={kind}
          onChange={setKind}
          options={['queue', 'campaign', 'skill', 'vdn', 'routingPoint', 'flow', 'dnis']}
        />
        <Field label={l('externalId')} value={externalId} onChange={setExternalId} required />
      </SaveForm>
      {rows.map((row) => (
        <div className="aw-inline" key={`${row.platform}:${row.kind}:${row.externalId}`}>
          <span>
            {row.platform} · {row.kind} · {row.externalId}
          </span>
          <Action
            label={l('remove')}
            danger
            run={() =>
              write(
                `/v1/campaigns/${id}`,
                { externalMappings: rows.filter((item) => item !== row) },
                'PATCH',
                query.data?.version,
              )
            }
          />
        </div>
      ))}
    </>
  );
}
