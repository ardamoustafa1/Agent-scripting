import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  ACTIONS,
  RESOURCES,
  RESOURCE_ACTIONS,
  RESOURCE_SUBJECT,
  type Resource,
} from '@verbis/authz';
import { Alert, Button } from '@verbis/ui';

import { useCan } from './access.js';
import { request, text, useAdmin, useWrite, type Row } from './api.js';
import {
  Action,
  Card,
  Check,
  Field,
  ResourceList,
  SaveForm,
  useEnumLabel,
  useLabels,
} from './widgets.js';

const AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'tls_client_auth'] as const;
const Created = z.looseObject({
  clientId: z.string(),
  name: z.string(),
  clientSecret: z.string().nullable(),
  tokenEndpoint: z.string(),
  authMethod: z.string(),
});
type Revealed = z.infer<typeof Created>;

/** `read:Script`: the permission scopes a service client may hold, grouped by resource. */
function ScopeChecklist({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const l = useLabels(),
    enumLabel = useEnumLabel(),
    selected = new Set(value);
  const toggle = (scope: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(scope);
    else next.delete(scope);
    onChange([...next]);
  };
  return (
    <div className="aw-field" role="group" aria-label={l('clients.scopes')}>
      <span>{l('clients.scopes')}</span>
      <p className="aw-hint">{l('clients.scopesHint')}</p>
      <div className="aw-inline">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange(
              RESOURCES.filter((resource) => RESOURCE_ACTIONS[resource].includes('read')).map(
                (resource) => `read:${RESOURCE_SUBJECT[resource]}`,
              ),
            );
          }}
        >
          {l('clients.presetRead')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange([]);
          }}
        >
          {l('clients.presetClear')}
        </Button>
      </div>
      <div className="aw-matrix">
        {RESOURCES.map((resource: Resource) => (
          <fieldset key={resource} disabled={disabled}>
            <legend>{enumLabel('resource', resource)}</legend>
            {ACTIONS.filter((action) => RESOURCE_ACTIONS[resource].includes(action)).map(
              (action) => {
                const scope = `${action}:${RESOURCE_SUBJECT[resource]}`;
                return (
                  <Check
                    key={scope}
                    label={enumLabel('action', action)}
                    checked={selected.has(scope)}
                    onChange={(on) => {
                      toggle(scope, on);
                    }}
                  />
                );
              },
            )}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

/** The secret exists only in this card: it is shown once and never stored in the browser. */
function SecretReveal({ client, onDone }: { client: Revealed; onDone: () => void }) {
  const l = useLabels(),
    [copied, setCopied] = useState<'secret' | 'failed' | null>(null),
    [stored, setStored] = useState(false);
  return (
    <Card title={l('clients.revealTitle')}>
      <Alert tone="warning" title={l('clients.revealWarning')} />
      <dl className="aw-secret">
        <dt>{l('clients.clientId')}</dt>
        <dd>
          <code>{client.clientId}</code>
        </dd>
        <dt>{l('clients.tokenEndpoint')}</dt>
        <dd>
          <code>{client.tokenEndpoint}</code>
        </dd>
        {client.clientSecret ? (
          <>
            <dt>{l('clients.clientSecret')}</dt>
            <dd>
              <code data-testid="client-secret">{client.clientSecret}</code>
            </dd>
          </>
        ) : (
          <>
            <dt>{l('clients.clientSecret')}</dt>
            <dd>{l('clients.noSecret')}</dd>
          </>
        )}
      </dl>
      {client.clientSecret ? (
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              .writeText(client.clientSecret ?? '')
              .then(() => {
                setCopied('secret');
              })
              .catch(() => {
                setCopied('failed');
              });
          }}
        >
          {l('clients.copySecret')}
        </Button>
      ) : null}
      {copied === 'secret' ? <p role="status">{l('clients.copied')}</p> : null}
      {copied === 'failed' ? <p role="alert">{l('clients.copyFailed')}</p> : null}
      <Check label={l('clients.stored')} checked={stored} onChange={setStored} />
      <Button disabled={!stored} onClick={onDone}>
        {l('clients.done')}
      </Button>
    </Card>
  );
}

function CreateClient({ onCreated }: { onCreated: (client: Revealed) => void }) {
  const l = useLabels(),
    can = useCan(),
    write = useWrite(),
    [name, setName] = useState(''),
    [authMethod, setAuthMethod] = useState<string>('client_secret_basic'),
    [certificate, setCertificate] = useState(''),
    [scopes, setScopes] = useState<string[]>([]);
  const mtls = authMethod === 'tls_client_auth';
  return (
    <Card title={l('clients.create')}>
      <p>{l('clients.createHint')}</p>
      <SaveForm
        submitLabel={l('clients.createButton')}
        disabled={!can('manage', 'Tenant') || scopes.length === 0 || (mtls && !certificate.trim())}
        onSave={async () => {
          const created = Created.parse(
            await write('/v1/service-clients', {
              name: name.trim(),
              authMethod,
              scopes,
              ...(certificate.trim() ? { certificate: certificate.trim() } : {}),
            }),
          );
          setName('');
          setCertificate('');
          setScopes([]);
          onCreated(created);
        }}
      >
        <Field label={l('name')} value={name} onChange={setName} required />
        <Field
          label={l('clients.authMethod')}
          value={authMethod}
          onChange={setAuthMethod}
          enumName="clientAuth"
          options={AUTH_METHODS}
        />
        <p className="aw-hint">{l(`clients.authHint.${authMethod}`)}</p>
        <Field
          label={mtls ? l('clients.certificateRequired') : l('clients.certificateOptional')}
          type="textarea"
          value={certificate}
          onChange={setCertificate}
          required={mtls}
        />
        <ScopeChecklist value={scopes} onChange={setScopes} />
        {scopes.length === 0 ? <p role="status">{l('clients.pickScope')}</p> : null}
      </SaveForm>
    </Card>
  );
}

function EditClient({
  row,
  onChanged,
  onRevealed,
}: {
  row: Row;
  onChanged: () => void;
  onRevealed: (client: Revealed) => void;
}) {
  const l = useLabels(),
    { t } = useTranslation(),
    can = useCan(),
    session = useAdmin(),
    write = useWrite(),
    [name, setName] = useState(text(row, 'name')),
    [status, setStatus] = useState(text(row, 'status')),
    [scopes, setScopes] = useState<string[]>(
      Array.isArray(row['scopes']) ? row['scopes'].map(String) : [],
    );
  const editable = can('manage', 'Tenant');
  return (
    <Card title={t('adminWorkspace.clients.edit', { name: text(row, 'name') })}>
      <SaveForm
        disabled={!editable || scopes.length === 0}
        onSave={async () => {
          await write(
            `/v1/service-clients/${row.id}`,
            { name: name.trim(), status, scopes },
            'PATCH',
            row.version,
          );
          onChanged();
        }}
      >
        <Field label={l('name')} value={name} onChange={setName} required disabled={!editable} />
        <Field
          label={l('status')}
          value={status}
          onChange={setStatus}
          enumName="status"
          options={['active', 'disabled']}
          disabled={!editable}
        />
        <ScopeChecklist value={scopes} onChange={setScopes} disabled={!editable} />
      </SaveForm>
      <h3>{l('clients.secretTitle')}</h3>
      {text(row, 'authMethod') === 'tls_client_auth' ? (
        <p>{l('clients.mtlsNoSecret')}</p>
      ) : (
        <>
          <p>{l('clients.rotateHint')}</p>
          <Action
            label={l('clients.rotate')}
            disabled={!editable}
            danger
            run={async () => {
              const rotated = Created.parse(
                await request(`/v1/service-clients/${row.id}/secret`, z.unknown(), {
                  method: 'POST',
                  body: {},
                  csrf: session.csrfToken,
                }),
              );
              onRevealed(rotated);
            }}
          />
        </>
      )}
      <h3>{l('clients.dangerTitle')}</h3>
      <p>{l('clients.deleteHint')}</p>
      <Action
        label={l('clients.delete')}
        danger
        disabled={!can('manage', 'Tenant')}
        run={async () => {
          await write(`/v1/service-clients/${row.id}`, undefined, 'DELETE', row.version);
          onChanged();
        }}
      />
    </Card>
  );
}

export default function ServiceClients() {
  const l = useLabels(),
    { t, i18n } = useTranslation(),
    [selected, setSelected] = useState<Row | null>(null),
    [revealed, setRevealed] = useState<Revealed | null>(null);
  const when = (value: string) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value),
        )
      : t('adminWorkspace.clients.neverUsed');
  return (
    <>
      {revealed ? (
        <SecretReveal
          client={revealed}
          onDone={() => {
            setRevealed(null);
          }}
        />
      ) : null}
      <Card title={l('clients.title')}>
        <p>{l('clients.intro')}</p>
        <ResourceList
          path="/v1/service-clients"
          title={l('clients.title')}
          columns={['name', 'authMethod', 'scopes', 'status', 'lastUsedAt']}
          enums={{ authMethod: 'clientAuth' }}
          format={{
            scopes: (row) =>
              t('adminWorkspace.clients.scopeCount', {
                count: Array.isArray(row['scopes']) ? row['scopes'].length : 0,
              }),
            lastUsedAt: (row) => when(text(row, 'lastUsedAt')),
          }}
          onSelect={setSelected}
        />
      </Card>
      {selected ? (
        <EditClient
          key={`${selected.id}-${String(selected.version)}`}
          row={selected}
          onChanged={() => {
            setSelected(null);
          }}
          onRevealed={setRevealed}
        />
      ) : null}
      <CreateClient onCreated={setRevealed} />
    </>
  );
}
