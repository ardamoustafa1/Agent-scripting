import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  AdminTenantInputSchema,
  AdminBrandSchema,
  AdminPrivacyInputSchema,
  AdminPublicJwksSchema,
  AdminClassificationSchema,
} from '@verbis/shared-types';
import { Button, Dialog, UiProvider, useTheme } from '@verbis/ui';

import { useCan } from './access.js';
import {
  useResource,
  useWrite,
  RowSchema,
  record,
  text,
  csv,
  json,
  download,
  type Row,
} from './api.js';
import {
  Card,
  Field,
  Check,
  SaveForm,
  ResourceList,
  Action,
  JsonView,
  Feedback,
  useLabels,
} from './widgets.js';

const TenantSchema = RowSchema.extend({
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  version: z.number(),
});
export function Tenants() {
  const l = useLabels(),
    write = useWrite(),
    [selected, setSelected] = useState<Row | null>(null),
    [slug, setSlug] = useState(''),
    [name, setName] = useState(''),
    [region, setRegion] = useState('eu'),
    [status, setStatus] = useState('active'),
    [users, setUsers] = useState('1000'),
    [scripts, setScripts] = useState('1000'),
    [sessions, setSessions] = useState('1000'),
    [features, setFeatures] = useState('{}');
  function select(row: Row) {
    setSelected(row);
    setSlug(text(row, 'slug'));
    setName(text(row, 'name'));
    setRegion(text(row, 'region'));
    setStatus(text(row, 'status'));
    const quota = record(row['quotas']);
    setUsers(text(quota, 'maxUsers'));
    setScripts(text(quota, 'maxScripts'));
    setSessions(text(quota, 'maxActiveSessions'));
    setFeatures(JSON.stringify(row['features'], null, 2));
  }
  return (
    <>
      <Card title={l('tenants')}>
        <ResourceList
          path="/v1/admin/tenants"
          title={l('tenants')}
          columns={['name', 'slug', 'region', 'status']}
          onSelect={select}
        />
      </Card>
      <Card title={selected ? l('edit') : l('create')}>
        <Button
          variant="ghost"
          onClick={() => {
            setSelected(null);
            setSlug('');
            setName('');
          }}
        >
          {l('create')}
        </Button>
        <SaveForm
          onSave={() =>
            write(
              `/v1/admin/tenants${selected ? `/${selected.id}` : ''}`,
              AdminTenantInputSchema.parse({
                slug,
                name,
                region,
                status,
                quotas: {
                  maxUsers: Number(users),
                  maxScripts: Number(scripts),
                  maxActiveSessions: Number(sessions),
                },
                features: json(features),
              }),
              selected ? 'PUT' : 'POST',
              selected?.version,
            )
          }
        >
          <Field
            label={l('slug')}
            value={slug}
            onChange={setSlug}
            required
            disabled={selected !== null}
          />
          <Field label={l('name')} value={name} onChange={setName} required />
          <Field label={l('region')} value={region} onChange={setRegion} required />
          <Field
            label={l('status')}
            value={status}
            onChange={setStatus}
            enumName="status"
            options={['provisioning', 'active', 'suspended']}
          />
          <Field label={l('maxUsers')} type="number" value={users} onChange={setUsers} />
          <Field label={l('maxScripts')} type="number" value={scripts} onChange={setScripts} />
          <Field
            label={l('maxActiveSessions')}
            type="number"
            value={sessions}
            onChange={setSessions}
          />
          <Field label={l('features')} type="textarea" value={features} onChange={setFeatures} />
          <p>{l('quotaHint')}</p>
        </SaveForm>
      </Card>
    </>
  );
}
export function Security() {
  const can = useCan(),
    { t } = useTranslation(),
    write = useWrite(),
    [name, setName] = useState('');
  const tenant = useResource('/v1/tenant', TenantSchema);
  return tenant.data ? (
    <>
      {can('manage', 'Tenant') &&
        can('create', 'Campaign') &&
        can('create', 'Script') &&
        can('create', 'Connector') && (
          <Card title={t('admin.onboarding.title')}>
            <p>{t('admin.onboarding.help')}</p>
            <SaveForm onSave={() => write('/v1/tenant/onboarding', { name })}>
              <Field label={t('admin.onboarding.name')} value={name} onChange={setName} required />
            </SaveForm>
          </Card>
        )}
      <Locations />
      <SecurityForm key={tenant.data.version} tenant={tenant.data} />
    </>
  ) : (
    <Feedback error={tenant.error} />
  );
}
export function Locations() {
  const { t } = useTranslation(),
    can = useCan(),
    write = useWrite();
  const [selected, setSelected] = useState<Row | null>(null),
    [code, setCode] = useState(''),
    [name, setName] = useState('');
  if (!can('read', 'User')) return null;
  return (
    <Card title={t('admin.locations.title')}>
      <ResourceList
        path="/v1/locations"
        title={t('admin.locations.title')}
        columns={['code', 'name']}
        onSelect={(row) => {
          setSelected(row);
          setCode(text(row, 'code'));
          setName(text(row, 'name'));
        }}
      />
      {can('manage', 'Tenant') && (
        <>
          <Button
            onClick={() => {
              setSelected(null);
              setCode('');
              setName('');
            }}
          >
            {t('admin.locations.create')}
          </Button>
          <SaveForm
            onSave={() =>
              write(
                selected ? `/v1/locations/${selected.id}` : '/v1/locations',
                selected ? { name } : { code, name },
                selected ? 'PATCH' : 'POST',
                selected?.version,
              )
            }
          >
            <Field
              label={t('admin.locations.code')}
              value={code}
              onChange={setCode}
              required
              disabled={selected !== null}
            />
            <Field label={t('admin.locations.name')} value={name} onChange={setName} required />
          </SaveForm>
          {selected && (
            <Action
              label={t('admin.locations.remove')}
              danger
              run={() =>
                write(`/v1/locations/${selected.id}`, undefined, 'DELETE', selected.version)
              }
            />
          )}
        </>
      )}
    </Card>
  );
}
function SecurityForm({ tenant }: { tenant: z.infer<typeof TenantSchema> }) {
  const l = useLabels(),
    write = useWrite(),
    settings = tenant.settings,
    session = record(settings['session']),
    [idle, setIdle] = useState(text(session, 'idleTimeoutMinutes') || '30'),
    [absolute, setAbsolute] = useState(text(session, 'absoluteTimeoutHours') || '12'),
    [concurrent, setConcurrent] = useState(text(session, 'maxConcurrentSessions') || '3'),
    [onLimit, setLimit] = useState(text(session, 'onLimit') || 'evict_oldest'),
    [ips, setIps] = useState(
      z.array(z.string()).catch([]).parse(record(settings['security'])['ipAllowlist']).join('\n'),
    ),
    [frames, setFrames] = useState(
      z
        .array(z.string())
        .catch([])
        .parse(record(settings['embedding'])['frameAncestors'])
        .join('\n'),
    ),
    [sod, setSod] = useState(record(settings['authz'])['separationOfDuties'] !== false);
  return (
    <>
      <Card title={l('security')}>
        <SaveForm
          onSave={() =>
            write(
              '/v1/tenant/settings',
              {
                session: {
                  idleTimeoutMinutes: Number(idle),
                  absoluteTimeoutHours: Number(absolute),
                  maxConcurrentSessions: Number(concurrent),
                  onLimit,
                },
                security: { ipAllowlist: csv(ips) },
                embedding: { frameAncestors: csv(frames) },
                authz: { separationOfDuties: sod },
              },
              'PATCH',
              tenant.version,
            )
          }
        >
          <Field label={l('idle')} type="number" value={idle} onChange={setIdle} />
          <Field label={l('absolute')} type="number" value={absolute} onChange={setAbsolute} />
          <Field
            label={l('concurrent')}
            type="number"
            value={concurrent}
            onChange={setConcurrent}
          />
          <Field
            label={l('onLimit')}
            value={onLimit}
            onChange={setLimit}
            enumName="sessionLimit"
            options={['evict_oldest', 'deny']}
          />
          <Field label={l('ips')} type="textarea" value={ips} onChange={setIps} />
          <Field label={l('frames')} type="textarea" value={frames} onChange={setFrames} />
          <Check label={l('sod')} checked={sod} onChange={setSod} />
        </SaveForm>
      </Card>
      <LaunchKeys />
    </>
  );
}
function LaunchKeys() {
  const l = useLabels(),
    write = useWrite(),
    [selected, setSelected] = useState<Row | null>(null),
    [issuer, setIssuer] = useState(''),
    [status, setStatus] = useState('active'),
    [keys, setKeys] = useState('{"keys":[]}');
  return (
    <Card title={l('jwks')}>
      <ResourceList
        path="/v1/admin/launch-issuers"
        title={l('jwks')}
        columns={['issuer', 'status', 'version']}
        onSelect={(row) => {
          setSelected(row);
          setIssuer(text(row, 'issuer'));
          setStatus(text(row, 'status'));
          setKeys(JSON.stringify(row['jwks'], null, 2));
        }}
      />
      <Button
        variant="ghost"
        onClick={() => {
          setSelected(null);
          setIssuer('');
          setKeys('{"keys":[]}');
        }}
      >
        {l('create')}
      </Button>
      <p>{l('keyHint')}</p>
      <SaveForm
        onSave={() =>
          write(
            `/v1/admin/launch-issuers${selected ? `/${selected.id}` : ''}`,
            { issuer, status, jwks: AdminPublicJwksSchema.parse(json(keys)) },
            selected ? 'PUT' : 'POST',
            selected?.version,
          )
        }
      >
        <Field label={l('issuer')} value={issuer} onChange={setIssuer} required />
        <Field
          label={l('status')}
          value={status}
          onChange={setStatus}
          enumName="status"
          options={['active', 'disabled']}
        />
        <Field label={l('publicKeys')} type="textarea" value={keys} onChange={setKeys} />
      </SaveForm>
    </Card>
  );
}
export function Branding() {
  const tenant = useResource('/v1/tenant', TenantSchema);
  return tenant.data ? (
    <BrandForm key={tenant.data.version} tenant={tenant.data} />
  ) : (
    <Feedback error={tenant.error} />
  );
}
function BrandForm({ tenant }: { tenant: z.infer<typeof TenantSchema> }) {
  const l = useLabels(),
    { i18n } = useTranslation(),
    [theme] = useTheme(),
    write = useWrite(),
    brand = record(tenant.settings['brand']),
    [name, setName] = useState(text(brand, 'name') || tenant.name),
    [color, setColor] = useState(text(brand, 'primaryColor') || '#5145cd'),
    [logo, setLogo] = useState(text(brand, 'logoUrl')),
    [title, setTitle] = useState(text(brand, 'agentTitle')),
    [waiting, setWaiting] = useState(text(brand, 'waitingText'));
  return (
    <Card title={l('branding')}>
      <SaveForm
        onSave={() =>
          write(
            '/v1/tenant/settings',
            {
              brand: AdminBrandSchema.parse({
                name,
                primaryColor: color,
                logoUrl: logo,
                agentTitle: title,
                waitingText: waiting,
              }),
            },
            'PATCH',
            tenant.version,
          )
        }
      >
        <Field label={l('name')} value={name} onChange={setName} required />
        <Field label={l('primaryColor')} type="color" value={color} onChange={setColor} />
        <Field label={l('logoUrl')} type="url" value={logo} onChange={setLogo} />
        <Field label={l('agentTitle')} value={title} onChange={setTitle} />
        <Field label={l('waitingText')} value={waiting} onChange={setWaiting} />
      </SaveForm>
      {/* V-02: the preview inherits the viewer's theme instead of the light default. */}
      <UiProvider i18n={i18n} theme={theme} brand={{ name, primaryColor: color }}>
        <div className="aw-brand-preview">
          <strong>{name}</strong>
          <p>{title || l('agentTitle')}</p>
          <Dialog
            trigger={<Button>{l('preview')}</Button>}
            title={l('preview')}
            description={l('branding')}
          >
            <div className="aw-brand-preview">
              <strong>{name}</strong>
              <h2>{title || l('agentTitle')}</h2>
              <p>{waiting || l('waitingText')}</p>
            </div>
          </Dialog>
        </div>
      </UiProvider>
      <p>{l('contrastHint')}</p>
    </Card>
  );
}
export function DataManagement() {
  const tenant = useResource('/v1/tenant', TenantSchema);
  return (
    <>
      {tenant.data ? (
        <Retention key={tenant.data.version} tenant={tenant.data} />
      ) : (
        <Feedback error={tenant.error} />
      )}
      {tenant.data ? (
        <Classifications key={`pii-${tenant.data.version}`} tenant={tenant.data} />
      ) : null}
      <Privacy />
    </>
  );
}
function Retention({ tenant }: { tenant: z.infer<typeof TenantSchema> }) {
  const l = useLabels(),
    write = useWrite(),
    audit = record(tenant.settings['audit']),
    [days, setDays] = useState(text(audit, 'retentionDays') || '365'),
    [session, setSession] = useState(text(audit, 'sessionRetentionDays') || '90'),
    [analytics, setAnalytics] = useState(text(audit, 'analyticsRetentionDays') || '365'),
    [hold, setHold] = useState(audit['legalHold'] === true);
  return (
    <Card title={l('retention')}>
      <SaveForm
        onSave={() =>
          write(
            '/v1/tenant/settings',
            {
              audit: {
                retentionDays: Number(days),
                sessionRetentionDays: Number(session),
                analyticsRetentionDays: Number(analytics),
                legalHold: hold,
              },
            },
            'PATCH',
            tenant.version,
          )
        }
      >
        <Field label={l('auditDays')} type="number" value={days} onChange={setDays} />
        <Field label={l('sessionDays')} type="number" value={session} onChange={setSession} />
        <Field label={l('analyticsDays')} type="number" value={analytics} onChange={setAnalytics} />
        <Check label={l('legalHold')} checked={hold} onChange={setHold} />
        <p>{l('retentionHint')}</p>
      </SaveForm>
    </Card>
  );
}
function Privacy() {
  const l = useLabels(),
    write = useWrite(),
    [kind, setKind] = useState('search'),
    [subject, setSubject] = useState(''),
    [reason, setReason] = useState(''),
    [verified, setVerified] = useState(false),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <Card title={l('privacy')}>
      <p>{l('privacyHint')}</p>
      <SaveForm
        disabled={!verified}
        onSave={async () => {
          const result = await write(
            '/v1/admin/privacy-requests',
            AdminPrivacyInputSchema.parse({ kind, subject, reason, verified }),
          );
          setSubject('');
          setReason('');
          setVerified(false);
          return result;
        }}
      >
        <Field
          label={l('kind')}
          value={kind}
          onChange={setKind}
          enumName="privacyKind"
          options={['search', 'export', 'anonymize']}
        />
        <Field label={l('subject')} value={subject} onChange={setSubject} required />
        <Field label={l('reason')} type="textarea" value={reason} onChange={setReason} required />
        <Check label={l('verified')} checked={verified} onChange={setVerified} />
      </SaveForm>
      <ResourceList
        path="/v1/admin/privacy-requests"
        title={l('privacy')}
        columns={['kind', 'state', 'createdAt', 'count']}
        enums={{ kind: 'privacyKind', state: 'privacyState' }}
        onSelect={setSelected}
      />
      {selected ? (
        <>
          <JsonView value={selected} />
          {selected['state'] === 'pending' ? (
            <Action
              key={`process:${selected.id}:${selected.version}`}
              label={l('process')}
              danger
              run={() =>
                write(
                  `/v1/admin/privacy-requests/${selected.id}/process`,
                  { confirmRequestId: selected.id },
                  'POST',
                  selected.version,
                ).then((result) => {
                  setSelected(RowSchema.parse(result));
                })
              }
            />
          ) : null}
          {selected['kind'] === 'export' && selected['state'] === 'completed' ? (
            <Action
              label={l('export')}
              run={() =>
                download(`/v1/admin/privacy-requests/${selected.id}/export`, 'privacy.json')
              }
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function Classifications({ tenant }: { tenant: z.infer<typeof TenantSchema> }) {
  const l = useLabels(),
    write = useWrite(),
    [items, setItems] = useState(() =>
      AdminClassificationSchema.parse(tenant.settings['classifications'] ?? []),
    );
  return (
    <Card title={l('classifications')}>
      <p>{l('classificationHint')}</p>
      <SaveForm
        onSave={() =>
          write(
            '/v1/tenant/settings',
            { classifications: AdminClassificationSchema.parse(items) },
            'PATCH',
            tenant.version,
          )
        }
      >
        {items.map((item, index) => (
          <div className="aw-rule" key={index}>
            <Field
              label={l('path')}
              value={item.path}
              onChange={(path) => {
                setItems((old) =>
                  old.map((entry, i) => (i === index ? { ...entry, path } : entry)),
                );
              }}
            />
            <Field
              label={l('classification')}
              value={item.classification}
              enumName="classification"
              options={['public', 'internal', 'pii', 'pci']}
              onChange={(value) => {
                setItems((old) =>
                  old.map((entry, i) =>
                    i === index
                      ? {
                          ...entry,
                          classification: z.enum(['public', 'internal', 'pii', 'pci']).parse(value),
                        }
                      : entry,
                  ),
                );
              }}
            />
            <Field
              label={l('purpose')}
              value={item.purpose}
              onChange={(purpose) => {
                setItems((old) =>
                  old.map((entry, i) => (i === index ? { ...entry, purpose } : entry)),
                );
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setItems((old) => old.filter((_, i) => i !== index));
              }}
            >
              {l('remove')}
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => {
            setItems((old) => [...old, { path: '', classification: 'pii', purpose: '' }]);
          }}
        >
          {l('addRule')}
        </Button>
      </SaveForm>
    </Card>
  );
}
