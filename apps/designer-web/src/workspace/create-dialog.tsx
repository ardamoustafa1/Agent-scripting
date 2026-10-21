import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useCan } from '@verbis/authz/react';
import { Button, Dialog, Input, Textarea, Alert, Radio, Select } from '@verbis/ui';

import {
  request,
  ResourceSchema,
  ApiError,
  type CreateCampaign,
  type CreateScript,
} from '../api/client.js';

import { useWorkspace } from './context.js';
import { CreateCampaignPicker, useCreateCampaigns } from './create-campaign.js';

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
  const campaigns = useCreateCampaigns(open && allowed && kind === 'scripts');
  const selectedCampaign = campaigns.data?.some((c) => c.id === campaignId) === true;
  const submission = useRef<{ payload: string; key: string } | null>(null);
  const instantiate = useMutation({
    mutationFn: () => {
      if (!allowed || !selectedCampaign) throw new ApiError(403, 'VERBIS_AUTHZ_SCOPE_MISSING');
      const body = { name, campaignId, ...(description.trim() ? { description } : {}) };
      const payload = JSON.stringify({ templateId, ...body });
      if (submission.current?.payload !== payload)
        submission.current = { payload, key: crypto.randomUUID() };
      return request(`/v1/templates/${encodeURIComponent(templateId)}/instantiate`, Instantiated, {
        method: 'POST',
        csrf: session.csrfToken,
        body,
        idempotencyKey: submission.current.key,
      });
    },
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
      void navigate(
        `/${kind}/${item.id}`,
        kind === 'scripts' ? { state: { openEditor: true } } : undefined,
      );
    },
  });
  const failure = fromTemplate ? instantiate.error : create.error;
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
        {kind === 'scripts' && (
          <CreateCampaignPicker campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
        )}
        {failure && (
          <Alert
            tone="danger"
            title={t(
              failure instanceof ApiError && failure.status === 403
                ? failure.code === 'VERBIS_AUTHZ_SCOPE_MISSING'
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
            !name.trim() ||
            (kind === 'scripts' && !selectedCampaign) ||
            (fromTemplate && !templateId)
          }
        >
          {t('designer.workspace.create')}
        </Button>
      </form>
    </Dialog>
  );
}
