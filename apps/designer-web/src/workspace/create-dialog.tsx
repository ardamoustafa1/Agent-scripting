import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import { useCan, useAbility } from '@verbis/authz/react';
import { Button, Dialog, Input, Textarea, Alert, Radio, Select } from '@verbis/ui';

import {
  request,
  ResourceSchema,
  PageSchema,
  ApiError,
  type CreateCampaign,
  type CreateScript,
} from '../api/client.js';

import { useWorkspace } from './context.js';

const TemplateList = z.array(z.object({ id: z.string(), name: z.string(), builtIn: z.boolean() }));
const Instantiated = z.object({
  script: z.object({ id: z.uuid() }),
  version: z.object({ number: z.number().int() }),
});

export function CreateDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: 'campaigns' | 'scripts';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { session } = useWorkspace();
  const navigate = useNavigate();
  const query = useQueryClient();
  const ability = useAbility();
  const allowed = useCan('create', kind === 'campaigns' ? 'Campaign' : 'Script');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [campaignId, setCampaignId] = useState('');
  // A7: start blank or from a tested template.
  const [start, setStart] = useState<'blank' | 'template'>('blank');
  const [templateId, setTemplateId] = useState('');
  const templates = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'create-templates',
    ],
    enabled: open && allowed && kind === 'scripts' && start === 'template',
    queryFn: ({ signal }) => request('/v1/templates', TemplateList, { signal }),
  });
  const fromTemplate = kind === 'scripts' && start === 'template';
  const campaignFieldId = useId();
  const campaigns = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'create-campaigns',
    ],
    enabled: open && allowed && kind === 'scripts',
    queryFn: async ({ signal }) => {
      const rows = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: '100', sort: 'name' });
        if (cursor) params.set('cursor', cursor);
        const page = await request(`/v1/campaigns?${params}`, PageSchema, { signal });
        rows.push(...page.data);
        cursor = page.page.nextCursor;
      } while (cursor);
      return rows.filter(
        (c) =>
          c.status !== 'archived' &&
          ability.can('read', asSubject('Campaign', { id: c.id })) &&
          ability.can('create', asSubject('Script', { campaignIds: [c.id] })),
      );
    },
  });
  const selectedCampaign = campaigns.data?.some((c) => c.id === campaignId) === true;
  const submission = useRef<{ payload: string; key: string } | null>(null);
  const instantiate = useMutation({
    mutationFn: () =>
      request(`/v1/templates/${encodeURIComponent(templateId)}/instantiate`, Instantiated, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { name, ...(description.trim() ? { description } : {}) },
      }),
    onSuccess: (value) => {
      void query.invalidateQueries({ queryKey: ['workspace', session.user.tenantId] });
      onOpenChange(false);
      void navigate(`/scripts/${value.script.id}/versions/${String(value.version.number)}/edit`);
    },
  });
  const create = useMutation({
    mutationFn: () => {
      if (!allowed) throw new Error('VERBIS_FORBIDDEN');
      if (kind === 'scripts' && !selectedCampaign)
        throw new ApiError(403, 'VERBIS_AUTHZ_SCOPE_MISSING');
      const body: CreateCampaign | CreateScript =
        kind === 'campaigns'
          ? {
              name,
              description,
              channels: ['voice'],
              locales: [],
              externalMappings: [],
              outcomeSet: [],
              status: 'draft',
              defaultLocale: 'tr',
              queues: [],
            }
          : { name, description, tags: [], campaignId };
      const payload = JSON.stringify(body);
      if (submission.current?.payload !== payload)
        submission.current = { payload, key: crypto.randomUUID() };
      return request(`/v1/${kind}`, ResourceSchema, {
        method: 'POST',
        body,
        csrf: session.csrfToken,
        idempotencyKey: submission.current.key,
      });
    },
    onSuccess: (item) => {
      void query.invalidateQueries({ queryKey: ['workspace', session.user.tenantId] });
      onOpenChange(false);
      void navigate(`/${kind}/${item.id}`);
    },
  });
  return (
    <Dialog
      open={open && allowed}
      onOpenChange={onOpenChange}
      title={t(`designer.workspace.new.${kind}`)}
      description={t('designer.workspace.createDescription')}
    >
      <form
        className="dw-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (fromTemplate) instantiate.mutate();
          else create.mutate();
        }}
      >
        <Input
          required
          maxLength={120}
          label={t('designer.workspace.name')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Textarea
          maxLength={2000}
          label={t('designer.workspace.description')}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        {kind === 'scripts' && (
          <Radio
            label={t('designer.workspace.startWith.label')}
            value={start}
            onValueChange={(value) => {
              setStart(value === 'template' ? 'template' : 'blank');
            }}
            options={[
              { value: 'blank', label: t('designer.workspace.startWith.blank') },
              { value: 'template', label: t('designer.workspace.startWith.template') },
            ]}
          />
        )}
        {fromTemplate && (
          <>
            <Select
              label={t('designer.workspace.startWith.choose')}
              value={templateId}
              disabled={templates.isPending || templates.isError}
              onValueChange={setTemplateId}
              options={(templates.data ?? []).map((row) => ({
                value: row.id,
                label: row.builtIn ? t(`designer.lifecycle.templates.${row.id}`) : row.name,
              }))}
            />
            <p>{t('designer.workspace.startWith.templateHelp')}</p>
            {templates.isError && (
              <Alert tone="danger" title={t('designer.workspace.error')}>
                <Button variant="secondary" onClick={() => void templates.refetch()}>
                  {t('designer.workspace.retry')}
                </Button>
              </Alert>
            )}
          </>
        )}
        {kind === 'scripts' && !fromTemplate && (
          <>
            <div className="vb-form-field">
              <label htmlFor={campaignFieldId}>{t('designer.workspace.createCampaign')}</label>
              <select
                id={campaignFieldId}
                className="vb-input"
                value={campaignId}
                onChange={(event) => {
                  setCampaignId(event.target.value);
                }}
                disabled={campaigns.isPending || campaigns.isError}
                required
              >
                <option value="">{t('ui.select')}</option>
                {(campaigns.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <p>{t('designer.workspace.createCampaignHelp')}</p>
            {campaigns.isError && (
              <Alert tone="danger" title={t('designer.workspace.error')}>
                <Button variant="secondary" onClick={() => void campaigns.refetch()}>
                  {t('designer.workspace.retry')}
                </Button>
              </Alert>
            )}
            {campaigns.data?.length === 0 && (
              <Alert tone="warning" title={t('designer.workspace.noCreateCampaign')} />
            )}
          </>
        )}
        {instantiate.isError && <Alert tone="danger" title={t('designer.workspace.error')} />}
        {create.isError && (
          <Alert
            tone="danger"
            title={t(
              create.error instanceof ApiError && create.error.status === 403
                ? create.error.code === 'VERBIS_AUTHZ_SCOPE_MISSING'
                  ? 'designer.workspace.scopeMissing'
                  : 'designer.workspace.createForbidden'
                : 'designer.workspace.error',
            )}
          />
        )}
        <Button
          type="submit"
          loading={create.isPending || instantiate.isPending}
          disabled={
            !name.trim() || (fromTemplate ? !templateId : kind === 'scripts' && !selectedCampaign)
          }
        >
          {t('designer.workspace.create')}
        </Button>
      </form>
    </Dialog>
  );
}
