import { useState } from 'react';
import { z } from 'zod';

import {
  CustomRoleSchema,
  RESOURCE_ACTIONS,
  SCOPE_FIELDS,
  SCOPE_KINDS,
  RESOURCE_SUBJECT,
  RESOURCES,
  type CustomRole,
} from '@verbis/authz';
import { Button, Dialog } from '@verbis/ui';

import { useCan } from './access.js';
import {
  RowSchema,
  ListSchema,
  useResource,
  useWrite,
  record,
  text,
  csv,
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
  Picker,
  ScopePicker,
  useEnumLabel,
  useLabels,
  useRoleText,
} from './widgets.js';

const MappingSchema = z.object({
  rules: z.array(z.object({ claim: z.string(), equals: z.string(), roles: z.array(z.string()) })),
  defaultRoles: z.array(z.string()),
});
export function Identity() {
  const can = useCan(),
    l = useLabels(),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <Card title={l('identity')}>
        <ResourceList
          path="/v1/identity-providers"
          title={l('identity')}
          columns={['displayName', 'protocol', 'status']}
          onSelect={setSelected}
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
      {selected ? <IdpDetail key={selected.id} id={selected.id} /> : <IdpWizard />}
      {can('read', 'BreakGlassAccount') ? <BreakGlass /> : null}
    </>
  );
}
function IdpWizard() {
  const l = useLabels(),
    write = useWrite(),
    [protocol, setProtocol] = useState('oidc'),
    [name, setName] = useState(''),
    [domains, setDomains] = useState(''),
    [issuer, setIssuer] = useState(''),
    [client, setClient] = useState(''),
    [secret, setSecret] = useState(''),
    [entity, setEntity] = useState(''),
    [sso, setSso] = useState(''),
    [certs, setCerts] = useState(''),
    [jit, setJit] = useState(false),
    [scim, setScim] = useState(false),
    [error, setError] = useState<unknown>(),
    [discovery, setDiscovery] = useState<unknown>();
  return (
    <Card title={l('idpWizard')}>
      <SaveForm
        onSave={async () => {
          const config =
            protocol === 'oidc'
              ? {
                  vendor: 'generic',
                  issuer: issuer.replace(/\/\.well-known\/openid-configuration$/, ''),
                  clientId: client,
                  clientAuth: 'client_secret_basic',
                  ...(secret ? { clientSecret: secret } : {}),
                  roleMapping: { rules: [], defaultRoles: [] },
                }
              : {
                  vendor: 'generic',
                  idpEntityId: entity,
                  ssoUrl: sso,
                  idpCertificates:
                    certs.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ??
                    [],
                  roleMapping: { rules: [], defaultRoles: [] },
                };
          try {
            return await write('/v1/identity-providers', {
              protocol,
              displayName: name,
              domains: csv(domains),
              status: 'draft',
              jitProvisioning: jit,
              scimEnabled: scim,
              config,
            });
          } finally {
            setSecret('');
          }
        }}
      >
        <Field
          label={l('protocol')}
          value={protocol}
          onChange={setProtocol}
          enumName="protocol"
          options={['oidc', 'saml']}
        />
        <Field label={l('displayName')} value={name} onChange={setName} required />
        <Field label={l('domains')} value={domains} onChange={setDomains} />
        {protocol === 'oidc' ? (
          <>
            <Field
              label={l('discoveryUrl')}
              type="url"
              value={issuer}
              onChange={setIssuer}
              required
            />
            <Action
              label={l('discover')}
              run={async () => {
                const result = record(await write('/v1/admin/identity/discovery', { url: issuer }));
                setIssuer(text(result, 'issuer'));
                setDiscovery(result);
              }}
            />
            <Field label={l('clientId')} value={client} onChange={setClient} required />
            <Field label={l('replaceSecret')} type="password" value={secret} onChange={setSecret} />
          </>
        ) : (
          <>
            <label className="aw-field">
              <span>{l('metadata')}</span>
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (file.size > 256000) {
                    setError(new Error(l('fileTooLarge')));
                    return;
                  }
                  void file
                    .text()
                    .then((xml) => write('/v1/admin/identity/saml-import', { xml }))
                    .then((value) => {
                      const result = record(value);
                      setEntity(text(result, 'idpEntityId'));
                      setSso(text(result, 'ssoUrl'));
                      setCerts(z.array(z.string()).parse(result['idpCertificates']).join('\n'));
                    })
                    .catch(setError);
                }}
              />
            </label>
            <Field label={l('entityId')} value={entity} onChange={setEntity} required />
            <Field label={l('ssoUrl')} type="url" value={sso} onChange={setSso} required />
            <Field label={l('certificate')} type="textarea" value={certs} onChange={setCerts} />
          </>
        )}
        <Check label={l('jit')} checked={jit} onChange={setJit} />
        <Check label={l('scim')} checked={scim} onChange={setScim} />
        <p>{l('idpDraftHint')}</p>
      </SaveForm>
      {discovery ? <JsonView value={discovery} /> : null}
      <Feedback error={error} />
    </Card>
  );
}
function IdpDetail({ id }: { id: string }) {
  const query = useResource(`/v1/identity-providers/${id}`, RowSchema);
  return query.data ? (
    <IdpEditor key={query.data.version} row={query.data} />
  ) : (
    <Feedback error={query.error} />
  );
}
function IdpEditor({ row }: { row: Row }) {
  const l = useLabels(),
    write = useWrite(),
    config = record(row['config']),
    initial = MappingSchema.parse(config['roleMapping'] ?? { rules: [], defaultRoles: [] }),
    [rules, setRules] = useState(initial.rules),
    [defaults, setDefaults] = useState(initial.defaultRoles.join(',')),
    [status, setStatus] = useState(text(row, 'status')),
    [jit, setJit] = useState(row['jitProvisioning'] === true),
    [scim, setScim] = useState(row['scimEnabled'] === true),
    [secret, setSecret] = useState(''),
    [oneTime, setOneTime] = useState<unknown>(null),
    [probe, setProbe] = useState<unknown>(null),
    [expiry, setExpiry] = useState('90');
  return (
    <Card title={text(row, 'displayName')}>
      <SaveForm
        onSave={async () => {
          const { clientSecretSet: _secretSet, spCredentials: _sp, ...writable } = config;
          try {
            return await write(
              `/v1/identity-providers/${row.id}`,
              {
                status,
                jitProvisioning: jit,
                scimEnabled: scim,
                config: {
                  ...writable,
                  roleMapping: MappingSchema.parse({ rules, defaultRoles: csv(defaults) }),
                  ...(secret ? { clientSecret: secret } : {}),
                },
              },
              'PATCH',
              row.version,
            );
          } finally {
            setSecret('');
          }
        }}
      >
        <Field
          label={l('status')}
          value={status}
          onChange={setStatus}
          enumName="status"
          options={['draft', 'active', 'disabled']}
        />
        {row['protocol'] === 'oidc' ? (
          <Field label={l('replaceSecret')} type="password" value={secret} onChange={setSecret} />
        ) : null}
        <Check label={l('jit')} checked={jit} onChange={setJit} />
        <Check label={l('scim')} checked={scim} onChange={setScim} />
        <h3>{l('claimMapping')}</h3>
        <Field label={l('defaultRoles')} value={defaults} onChange={setDefaults} />
        {rules.map((rule, index) => (
          <div className="aw-rule" key={index}>
            <Field
              label={l('claim')}
              value={rule.claim}
              onChange={(claim) => {
                setRules((items) =>
                  items.map((item, i) => (i === index ? { ...item, claim } : item)),
                );
              }}
            />
            <Field
              label={l('equals')}
              value={rule.equals}
              onChange={(equals) => {
                setRules((items) =>
                  items.map((item, i) => (i === index ? { ...item, equals } : item)),
                );
              }}
            />
            <Field
              label={l('roles')}
              value={rule.roles.join(',')}
              onChange={(value) => {
                setRules((items) =>
                  items.map((item, i) => (i === index ? { ...item, roles: csv(value) } : item)),
                );
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setRules((items) => items.filter((_, i) => i !== index));
              }}
            >
              {l('remove')}
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => {
            setRules((items) => [...items, { claim: 'groups', equals: '', roles: [] }]);
          }}
        >
          {l('addRule')}
        </Button>
      </SaveForm>
      <p>{l('connectionHint')}</p>
      <Action
        label={l('testConnection')}
        run={async () => {
          setProbe(await write(`/v1/admin/identity-providers/${row.id}/test`, {}));
        }}
      />
      {probe ? <JsonView value={probe} /> : null}
      <JsonView value={row['endpoints']} />
      <h3>{l('scimTokens')}</h3>
      <Field label={l('expiresInDays')} type="number" value={expiry} onChange={setExpiry} />
      <Action
        label={l('issue')}
        run={async () => {
          setOneTime(
            await write(`/v1/identity-providers/${row.id}/scim-tokens`, {
              expiresInDays: Number(expiry),
            }),
          );
        }}
      />
      <TokenList id={row.id} />
      <Dialog
        open={oneTime !== null}
        onOpenChange={(open) => {
          if (!open) setOneTime(null);
        }}
        title={l('shownOnce')}
        description={l('onceHint')}
      >
        <JsonView value={oneTime} />
        <Button
          onClick={() => {
            setOneTime(null);
          }}
        >
          {l('close')}
        </Button>
      </Dialog>
    </Card>
  );
}
function TokenList({ id }: { id: string }) {
  const l = useLabels(),
    write = useWrite(),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <ResourceList
        path={`/v1/identity-providers/${id}/scim-tokens`}
        title={l('scimTokens')}
        columns={['prefix', 'expiresAt', 'lastUsedAt']}
        onSelect={setSelected}
      />
      {selected ? (
        <Action
          key={selected.id}
          label={l('revoke')}
          danger
          run={() =>
            write(
              `/v1/identity-providers/${id}/scim-tokens/${selected.id}`,
              undefined,
              'DELETE',
            ).then(() => {
              setSelected(null);
            })
          }
        />
      ) : null}
    </>
  );
}
function BreakGlass() {
  const l = useLabels(),
    can = useCan(),
    write = useWrite(),
    [user, setUser] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [credential, setCredential] = useState<unknown>(null),
    [selected, setSelected] = useState('');
  const accounts = useResource(
    '/v1/break-glass-accounts',
    z.array(
      z.object({ userId: z.string(), status: z.string(), lastUsedAt: z.string().nullable() }),
    ),
  );
  if (!can('read', 'BreakGlassAccount')) return null;
  return (
    <Card title={l('breakGlass')}>
      <Feedback error={accounts.error} />
      {accounts.data?.map((account) => (
        <div className="aw-inline" key={account.userId}>
          <span>
            {account.userId} · {account.status}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setSelected(account.userId);
            }}
          >
            {l('details')}
          </Button>
        </div>
      ))}
      {can('manage', 'BreakGlassAccount') ? (
        <>
          <SaveForm
            onSave={async () => {
              try {
                setCredential(await write('/v1/break-glass-accounts', { userId: user, password }));
              } finally {
                setPassword('');
              }
            }}
          >
            <Picker path="/v1/users" label={l('user')} value={user} onChange={setUser} />
            <Field
              label={l('password')}
              type="password"
              value={password}
              onChange={setPassword}
              required
            />
          </SaveForm>
          <Dialog
            open={credential !== null}
            onOpenChange={(open) => {
              if (!open) setCredential(null);
            }}
            title={l('shownOnce')}
            description={l('onceHint')}
          >
            <JsonView value={credential} />
            <Button
              onClick={() => {
                setCredential(null);
              }}
            >
              {l('close')}
            </Button>
          </Dialog>
          <Field label={l('totp')} value={code} onChange={setCode} />
          <Action
            disabled={!user || !/^\d{6}$/.test(code)}
            label={l('activate')}
            run={() =>
              write(`/v1/break-glass-accounts/${user}/activate`, { code }).then(() => {
                setCode('');
              })
            }
          />
          {selected ? (
            <Action
              key={selected}
              danger
              label={l('disable')}
              run={() => write(`/v1/break-glass-accounts/${selected}`, undefined, 'DELETE')}
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
export function Users() {
  const can = useCan(),
    l = useLabels(),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <Card title={l('users')}>
        <ResourceList
          path="/v1/users"
          title={l('users')}
          columns={['displayName', 'email', 'status']}
          onSelect={setSelected}
        />
      </Card>
      {selected && can('read', 'Role') ? <UserEditor key={selected.id} id={selected.id} /> : null}
      {can('read', 'Role') ? <RoleEditor /> : null}
    </>
  );
}
function UserEditor({ id }: { id: string }) {
  const l = useLabels(),
    enumLabel = useEnumLabel(),
    { label: roleLabel } = useRoleText(),
    can = useCan(),
    write = useWrite(),
    assignments = useResource(
      `/v1/users/${id}/roles`,
      z.object({ roles: z.array(z.object({ name: z.string(), source: z.string() })) }),
    ),
    roles = useResource('/v1/authz/roles', ListSchema),
    [manual, setManual] = useState<string[] | null>(null),
    [scopeRole, setScopeRole] = useState(''),
    [campaigns, setCampaigns] = useState<'*' | string[]>([]),
    [teams, setTeams] = useState<'*' | string[]>([]),
    [sites, setSites] = useState<'*' | string[]>([]),
    [selectedSession, setSession] = useState<Row | null>(null);
  const current =
    manual ??
    assignments.data?.roles.filter((role) => role.source === 'manual').map((role) => role.name) ??
    [];
  return (
    <Card title={l('userDetails')}>
      <Feedback error={assignments.error} />
      <p>{l('sourceHint')}</p>
      {assignments.data?.roles
        .filter((role) => role.source !== 'manual')
        .map((role) => (
          <p key={`${role.name}:${role.source}`}>
            {roleLabel(role.name)} · {enumLabel('roleSource', role.source)}
          </p>
        ))}
      <SaveForm
        disabled={!assignments.data || !can('manage', 'Role') || !can('update', 'User')}
        onSave={() => write(`/v1/users/${id}/roles`, { roles: current }, 'PUT')}
      >
        <div className="aw-permissions">
          {roles.data?.data.map((role) => (
            <Check
              key={role.id}
              label={roleLabel(text(role, 'name'))}
              checked={current.includes(text(role, 'name'))}
              onChange={(checked) => {
                setManual(
                  checked
                    ? [...current, text(role, 'name')]
                    : current.filter((name) => name !== text(role, 'name')),
                );
              }}
            />
          ))}
        </div>
      </SaveForm>
      <SaveForm
        disabled={!can('update', 'Role') || !can('update', 'User')}
        onSave={() =>
          write(
            `/v1/authz/users/${id}/role-scope`,
            {
              role: scopeRole,
              scope: {
                campaignIds: campaigns,
                teamIds: teams,
                siteIds: sites,
              },
            },
            'PUT',
          )
        }
      >
        <Field
          label={l('role')}
          value={scopeRole}
          onChange={setScopeRole}
          options={['', ...new Set(assignments.data?.roles.map((role) => role.name) ?? [])]}
          optionLabel={(name) => (name ? roleLabel(name) : l('choose'))}
        />
        <ScopePicker
          path="/v1/campaigns?limit=100"
          label={l('campaignIds')}
          allLabel={l('allCampaigns')}
          nameKey="name"
          value={campaigns}
          onChange={setCampaigns}
        />
        <ScopePicker
          path="/v1/groups?limit=100&sort=displayName"
          label={l('teamIds')}
          allLabel={l('allTeams')}
          nameKey="displayName"
          value={teams}
          onChange={setTeams}
        />
        <ScopePicker
          path="/v1/locations?limit=100"
          label={l('siteIds')}
          allLabel={l('allSites')}
          nameKey="name"
          value={sites}
          onChange={setSites}
        />
        <p>{l('scopeHint')}</p>
      </SaveForm>
      <h3>{l('sessions')}</h3>
      <ResourceList
        path={`/v1/users/${id}/sessions`}
        title={l('sessions')}
        columns={['protocol', 'ip', 'lastSeenAt', 'expiresAt']}
        onSelect={setSession}
        poll
      />
      {can('manage', 'Session') ? (
        <>
          <Action
            label={l('terminateAll')}
            danger
            run={() => write(`/v1/users/${id}/sessions`, undefined, 'DELETE')}
          />
          {selectedSession ? (
            <Action
              key={selectedSession.id}
              label={l('terminate')}
              danger
              run={() =>
                write(`/v1/users/${id}/sessions/${selectedSession.id}`, undefined, 'DELETE')
              }
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
function RoleEditor() {
  const l = useLabels(),
    enumLabel = useEnumLabel(),
    role = useRoleText(),
    can = useCan(),
    write = useWrite(),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [matrix, setMatrix] = useState<CustomRole['matrix']>({});
  return (
    <Card title={l('customRole')}>
      <ResourceList
        path="/v1/authz/roles"
        title={l('roles')}
        columns={['name', 'description']}
        format={{ name: (row) => role.label(text(row, 'name')), description: role.description }}
      />
      <SaveForm
        disabled={!can('create', 'Role')}
        onSave={() =>
          write('/v1/authz/roles', CustomRoleSchema.parse({ name, description, matrix }))
        }
      >
        <Field label={l('name')} value={name} onChange={setName} required />
        <Field label={l('description')} value={description} onChange={setDescription} />
        <div className="aw-matrix">
          {RESOURCES.map((resource) => (
            <fieldset key={resource}>
              <legend>{enumLabel('resource', resource)}</legend>
              <Field
                label={l('scope')}
                value={matrix[resource]?.scope ?? 'all'}
                enumName="scope"
                options={['all', ...Object.keys(SCOPE_FIELDS[resource])]}
                onChange={(value) => {
                  setMatrix((current) => {
                    const cell = current[resource];
                    return cell
                      ? {
                          ...current,
                          [resource]: { ...cell, scope: z.enum(SCOPE_KINDS).parse(value) },
                        }
                      : current;
                  });
                }}
              />

              {RESOURCE_ACTIONS[resource].map((action) => (
                <label className="aw-check" key={action}>
                  <input
                    type="checkbox"
                    disabled={!can(action, RESOURCE_SUBJECT[resource])}
                    checked={matrix[resource]?.actions.includes(action) ?? false}
                    onChange={(event) => {
                      const old = matrix[resource];
                      const actions = event.target.checked
                        ? [...(old?.actions ?? []), action]
                        : (old?.actions ?? []).filter((value) => value !== action);
                      setMatrix((value) => {
                        const next = { ...value };
                        if (actions.length)
                          next[resource] = {
                            actions,
                            scope: old?.scope ?? 'all',
                            revealPii: old?.revealPii ?? false,
                          };
                        else
                          return Object.fromEntries(
                            Object.entries(next).filter(([key]) => key !== resource),
                          );
                        return next;
                      });
                    }}
                  />
                  {enumLabel('action', action)}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </SaveForm>
    </Card>
  );
}
