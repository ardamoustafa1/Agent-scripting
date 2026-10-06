import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers3 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Badge, Button, Input, Select, Dialog, Alert } from '@verbis/ui';

import { request, PageSchema, VersionsSchema } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';
import './styles.css';

const Templates = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
    builtIn: z.boolean(),
  }),
);
export default function TemplateGallery() {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient(),
    navigate = useNavigate();
  const key = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'template-gallery',
  ];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request('/v1/templates', Templates, { signal }),
  });
  const scripts = useQuery({
    queryKey: [...key, 'scripts'],
    queryFn: ({ signal }) => request('/v1/scripts?limit=100', PageSchema, { signal }),
    enabled: ability.can('create', 'Script'),
  });
  const [search, setSearch] = useState(''),
    [industry, setIndustry] = useState('all'),
    [source, setSource] = useState('all'),
    [chosen, setChosen] = useState<string | null>(null),
    [name, setName] = useState(''),
    [creating, setCreating] = useState(false),
    [scriptId, setScriptId] = useState(''),
    [version, setVersion] = useState(''),
    [category, setCategory] = useState('service'),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const versions = useQuery({
    queryKey: [...key, 'versions', scriptId],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`, VersionsSchema, {
        signal,
      }),
    enabled: !!scriptId,
  });
  const perform = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (creating) {
        await request('/v1/templates', z.object({ id: z.string() }), {
          method: 'POST',
          csrf: session.csrfToken,
          body: {
            name,
            category,
            scriptId,
            versionNumber: Number(version),
            tags: industry === 'all' ? [] : [industry],
          },
        });
        setCreating(false);
        await client.invalidateQueries({ queryKey: key });
      } else if (chosen) {
        const value = await request(
          `/v1/templates/${chosen}/instantiate`,
          z.object({
            script: z.object({ id: z.uuid() }),
            version: z.object({ number: z.number().int() }),
          }),
          { method: 'POST', csrf: session.csrfToken, body: { name } },
        );
        void navigate(`/scripts/${value.script.id}/versions/${value.version.number}/edit`);
        setChosen(null);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (query.isError) return <Failure retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const label = (row: z.infer<typeof Templates>[number]) =>
    row.builtIn ? t(`designer.lifecycle.templates.${row.id}`) : row.name;
  const rows = query.data.filter(
    (row) =>
      (industry === 'all' || row.tags.includes(industry)) &&
      (source === 'all' || (source === 'builtin') === row.builtIn) &&
      label(row).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <section>
      <div className="dw-page-heading">
        <div>
          <h1>{t('designer.lifecycle.gallery')}</h1>
          <p>{t('designer.lifecycle.galleryHelp')}</p>
        </div>
        {ability.can('create', 'Script') && (
          <Button
            onClick={() => {
              setCreating(true);
              setName('');
            }}
          >
            {t('designer.lifecycle.createTemplate')}
          </Button>
        )}
      </div>
      <div className="lc-toolbar">
        <Input
          label={t('designer.workspace.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <Select
          label={t('designer.lifecycle.industry')}
          value={industry}
          onValueChange={setIndustry}
          options={[
            'all',
            'banking',
            'telecom',
            'insurance',
            'ecommerce',
            'collections',
            'survey',
          ].map((value) => ({ value, label: t(`designer.lifecycle.industries.${value}`) }))}
        />
        <Select
          label={t('designer.lifecycle.templateSource')}
          value={source}
          onValueChange={setSource}
          options={['all', 'builtin', 'tenant'].map((value) => ({
            value,
            label: t(`designer.lifecycle.sources.${value}`),
          }))}
        />
      </div>
      <div className="lc-gallery">
        {rows.map((row) => (
          <article className="lc-card lc-template" key={row.id}>
            <span className="lc-template-icon" aria-hidden>
              <Layers3 size={36} aria-hidden />
            </span>
            <Badge tone={row.builtIn ? 'info' : 'success'}>
              {t(`designer.lifecycle.sources.${row.builtIn ? 'builtin' : 'tenant'}`)}
            </Badge>
            <h2>{label(row)}</h2>
            <p>{row.description ?? t('designer.lifecycle.templateHelp')}</p>
            <div>
              {row.tags.map((tag) => (
                <Badge key={tag}>
                  {t(`designer.lifecycle.industries.${tag}`, { defaultValue: tag })}
                </Badge>
              ))}
            </div>
            <Button
              disabled={!ability.can('create', 'Script')}
              onClick={() => {
                setChosen(row.id);
                setName(label(row));
                setCreating(false);
              }}
            >
              {t('designer.lifecycle.useTemplate')}
            </Button>
          </article>
        ))}
      </div>
      <Dialog
        open={!!chosen || creating}
        onOpenChange={(open) => {
          if (!open) {
            setChosen(null);
            setCreating(false);
          }
        }}
        title={t(creating ? 'designer.lifecycle.createTemplate' : 'designer.lifecycle.useTemplate')}
        description={t('designer.lifecycle.templateHelp')}
      >
        <Input
          label={t('designer.workspace.name')}
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        {creating && (
          <>
            <Select
              label={t('designer.workspace.nav.scripts')}
              value={scriptId}
              onValueChange={(value) => {
                setScriptId(value);
                setVersion('');
              }}
              options={(scripts.data?.data ?? []).map((row) => ({
                value: row.id,
                label: row.name,
              }))}
            />
            <Select
              label={t('designer.workspace.version')}
              value={version}
              onValueChange={setVersion}
              options={(versions.data?.data ?? []).map((row) => ({
                value: String(row.number),
                label: `v${row.number}`,
              }))}
            />
            <Select
              label={t('designer.lifecycle.category')}
              value={category}
              onValueChange={setCategory}
              options={[
                'sales',
                'service',
                'collections',
                'survey',
                'retention',
                'onboarding',
                'other',
              ].map((value) => ({ value, label: t(`designer.lifecycle.categories.${value}`) }))}
            />
          </>
        )}
        {failed && <Alert tone="danger" title={t('designer.lifecycle.failed')} />}
        <Button
          loading={busy}
          disabled={!name.trim() || (creating && (!scriptId || !version))}
          onClick={() => void perform()}
        >
          {t('designer.lifecycle.save')}
        </Button>
      </Dialog>
    </section>
  );
}
