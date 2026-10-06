import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Button, Input, Select, Alert, Badge } from '@verbis/ui';

import { request, VersionsSchema } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import './styles.css';

const Package = z
  .object({
    manifest: z.object({ packageId: z.string(), sourceEnvironment: z.string() }),
    payload: z.object({ scripts: z.array(z.object({ name: z.string() })) }),
  })
  .loose();
const Plan = z.object({
  packageId: z.string(),
  dryRun: z.boolean(),
  plan: z.array(z.object({ name: z.string(), semver: z.string(), action: z.string() })),
  dependencies: z.array(
    z.object({
      key: z.string(),
      version: z.number().int(),
      targetKey: z.string(),
      missing: z.boolean(),
      canCreate: z.boolean(),
      secretRefs: z.array(z.uuid()),
    }),
  ),
  created: z
    .array(z.object({ scriptId: z.uuid(), number: z.number().int(), name: z.string() }))
    .optional(),
});
const Sources = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      key: z.string(),
      version: z.number().int(),
      secretRefs: z.array(z.uuid()),
    }),
  ),
  page: z.object({ nextCursor: z.string().nullable() }),
});
const Secrets = z.object({ data: z.array(z.object({ id: z.uuid(), name: z.string() })) });
export default function PackagesPage() {
  const { id = '' } = useParams(),
    { t } = useTranslation(),
    { session, environment } = useWorkspace(),
    ability = useAbility();
  const [number, setNumber] = useState(''),
    [target, setTarget] = useState('test'),
    [payload, setPayload] = useState<Record<string, unknown> | null>(null),
    [mappings, setMappings] = useState<Record<string, { key: string; version: number }>>({}),
    [secrets, setSecrets] = useState<Record<string, string>>({}),
    [plan, setPlan] = useState<z.infer<typeof Plan> | null>(null),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const key = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'packages',
    id,
  ];
  const versions = useQuery({
    queryKey: [...key, 'versions'],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id}/versions?limit=100&sort=-number`, VersionsSchema, { signal }),
  });
  const sources = useQuery({
    queryKey: [...key, 'sources'],
    queryFn: ({ signal }) => request('/v1/data-sources?limit=100', Sources, { signal }),
    enabled: ability.can('read', 'Integration'),
  });
  const secretOptions = useQuery({
    queryKey: [...key, 'secrets'],
    queryFn: ({ signal }) => request('/v1/secrets?limit=100', Secrets, { signal }),
    enabled: ability.can('read', 'Secret'),
  });
  const perform = async (dryRun: boolean) => {
    if (!payload) return;
    setBusy(true);
    setFailed(false);
    try {
      const checked = await request(`/v1/script-packages/import?dryRun=${dryRun}`, Plan, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { package: payload, integrationMappings: mappings, secretMappings: secrets },
      });
      setPlan(checked);
      setVerified(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const pkg = await request('/v1/script-packages/export', z.record(z.string(), z.unknown()), {
        method: 'POST',
        csrf: session.csrfToken,
        body: {
          items: [{ scriptId: id, versionNumber: Number(number) }],
          targetEnvironments: [target],
        },
      });
      const parsed = Package.parse(pkg),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }),
        ),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${parsed.manifest.packageId}.verbis`;
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <Link className="dw-back" to={`/scripts/${id}`}>
        {t('designer.workspace.back')}
      </Link>
      <h1>{t('designer.lifecycle.transport')}</h1>
      <p>{t('designer.lifecycle.transportHelp')}</p>
      <Badge>{t(`designer.workspace.env.${environment}`)}</Badge>
      {failed && <Alert tone="danger" title={t('designer.lifecycle.packageFailed')} />}
      <div className="lc-release-grid">
        <article className="lc-card">
          <h2>{t('designer.lifecycle.export')}</h2>
          <Select
            label={t('designer.workspace.version')}
            value={number}
            onValueChange={setNumber}
            options={(versions.data?.data ?? [])
              .filter((v) => ['published', 'approved'].includes(v.state))
              .map((v) => ({ value: String(v.number), label: `v${v.number}` }))}
          />
          <Select
            label={t('designer.lifecycle.target')}
            value={target}
            onValueChange={setTarget}
            options={['dev', 'test', 'prod'].map((value) => ({ value, label: value }))}
          />
          <Button loading={busy} disabled={!number} onClick={() => void download()}>
            {t('designer.lifecycle.export')}
          </Button>
        </article>
        <article className="lc-card">
          <h2>{t('designer.lifecycle.import')}</h2>
          <Input
            type="file"
            accept=".verbis,application/json"
            label={t('designer.lifecycle.packageFile')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) {
                setFailed(true);
                return;
              }
              void file
                .text()
                .then((text) => {
                  try {
                    const body = z.record(z.string(), z.unknown()).parse(JSON.parse(text));
                    Package.parse(body);
                    setPayload(body);
                    setPlan(null);
                    setVerified(false);
                    setMappings({});
                    setSecrets({});
                  } catch {
                    setFailed(true);
                  }
                })
                .catch(() => {
                  setFailed(true);
                });
            }}
          />
          <Button
            loading={busy}
            disabled={!payload || !ability.can('create', 'Script')}
            onClick={() => void perform(true)}
          >
            {t('designer.lifecycle.checkDependencies')}
          </Button>
        </article>
      </div>
      {plan && (
        <article className="lc-card">
          <h2>{t('designer.lifecycle.dependencies')}</h2>
          <ul>
            {plan.plan.map((row) => (
              <li key={`${row.name}-${row.semver}`}>
                {row.name} {row.semver} <Badge>{t(`designer.lifecycle.${row.action}`)}</Badge>
              </li>
            ))}
          </ul>
          {plan.dependencies.map((dep) => (
            <section key={dep.key}>
              <h3>
                {t('designer.lifecycle.integrationVersion', { key: dep.key, version: dep.version })}{' '}
                <Badge tone={dep.missing ? 'danger' : 'success'}>
                  {t(dep.missing ? 'designer.lifecycle.missing' : 'designer.lifecycle.available')}
                </Badge>
              </h3>
              <Select
                label={t('designer.lifecycle.integrationMapping')}
                value={mappings[dep.key]?.key ?? dep.key}
                options={[
                  { value: dep.key, label: t('designer.lifecycle.keepOrCreate', { key: dep.key }) },
                  ...(sources.data?.data ?? [])
                    .filter((s) => s.key !== dep.key)
                    .map((s) => ({ value: s.key, label: `${s.key} v${s.version}` })),
                ]}
                onValueChange={(key) => {
                  const source = sources.data?.data.find((s) => s.key === key);
                  if (source)
                    setMappings((prev) => ({
                      ...prev,
                      [dep.key]: { key: source.key, version: source.version },
                    }));
                  else
                    setMappings((prev) => {
                      return Object.fromEntries(
                        Object.entries(prev).filter(([key]) => key !== dep.key),
                      );
                    });
                  setVerified(false);
                }}
              />
              {dep.canCreate &&
                dep.secretRefs.map((ref) => (
                  <Select
                    key={ref}
                    label={t('designer.lifecycle.secretMapping', { id: ref.slice(0, 8) })}
                    value={secrets[ref] ?? ''}
                    options={(secretOptions.data?.data ?? []).map((s) => ({
                      value: s.id,
                      label: s.name,
                    }))}
                    onValueChange={(value) => {
                      setSecrets((prev) => ({ ...prev, [ref]: value }));
                      setVerified(false);
                    }}
                  />
                ))}
            </section>
          ))}
          <p>{t('designer.lifecycle.secretHelp')}</p>
          <Button loading={busy} disabled={!payload} onClick={() => void perform(true)}>
            {t('designer.lifecycle.checkDependencies')}
          </Button>
          <Button
            loading={busy}
            disabled={
              !verified ||
              !plan.dryRun ||
              plan.dependencies.some((d) => d.missing) ||
              !ability.can('create', 'Script')
            }
            onClick={() => void perform(false)}
          >
            {t('designer.lifecycle.importDraft')}
          </Button>
          {plan.created?.map((row) => (
            <p key={row.scriptId}>
              <Link to={`/scripts/${row.scriptId}/versions/${row.number}/edit`}>{row.name}</Link>
            </p>
          ))}
        </article>
      )}
    </section>
  );
}
