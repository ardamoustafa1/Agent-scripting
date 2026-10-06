import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { LocaleSchema } from '@verbis/script-schema';
import { Alert, Button, Checkbox, Input, MultiSelect, Select, Textarea } from '@verbis/ui';

import { CampaignSchema, request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import './campaign-settings.css';

const split = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
const Outcome = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/)
    .max(64),
  label: z.string().trim().min(1).max(200),
  category: z.enum(['success', 'failure', 'callback', 'noContact', 'other']),
  requiresNote: z.boolean(),
  requiredFields: z
    .array(
      z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
        .max(64),
    )
    .max(50),
  subCodes: z
    .array(
      z
        .string()
        .regex(/^[A-Z0-9][A-Z0-9_-]*$/)
        .max(64),
    )
    .max(50),
});
const Fields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  status: CampaignSchema.shape.status,
  defaultLocale: LocaleSchema,
  locales: z.array(LocaleSchema).max(20),
  queues: z.array(z.string().min(1).max(128)).max(50),
  channels: z
    .array(z.enum(['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'video', 'callback']))
    .max(8),
  outcomeSet: z
    .array(Outcome)
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.code)).size === rows.length),
});
export function CampaignSettings({ campaign }: { campaign: z.infer<typeof CampaignSchema> }) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient();
  const [name, setName] = useState(campaign.name),
    [description, setDescription] = useState(campaign.description ?? ''),
    [status, setStatus] = useState(campaign.status),
    [locale, setLocale] = useState(campaign.defaultLocale),
    [locales, setLocales] = useState(campaign.locales.join(', ')),
    [queues, setQueues] = useState(campaign.queues.join(', ')),
    [channels, setChannels] = useState(campaign.channels),
    [outcomes, setOutcomes] = useState(
      campaign.outcomeSet.map((row) => ({
        ...row,
        required: row.requiredFields.join(', '),
        subs: row.subCodes.join(', '),
      })),
    );
  const allowed = ability.can('update', 'Campaign');
  const save = useMutation({
    mutationFn: () => {
      if (!allowed) throw new Error('VERBIS_FORBIDDEN');
      const body = Fields.parse({
        name,
        description,
        status,
        defaultLocale: locale,
        locales: split(locales),
        queues: split(queues),
        channels,
        outcomeSet: outcomes.map(({ required, subs, ...row }) => ({
          ...row,
          requiredFields: split(required),
          subCodes: split(subs),
        })),
      });
      return request(`/v1/campaigns/${campaign.id}`, CampaignSchema, {
        method: 'PATCH',
        body,
        ifMatch: `"${campaign.version}"`,
        csrf: session.csrfToken,
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['workspace', session.user.tenantId] });
    },
  });
  const update = (
    index: number,
    value: Partial<z.infer<typeof Outcome> & { required: string; subs: string }>,
  ) => {
    setOutcomes((rows) => rows.map((row, i) => (i === index ? { ...row, ...value } : row)));
  };
  return (
    <form
      className="dw-form dw-campaign-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending && allowed) save.mutate();
      }}
    >
      <fieldset disabled={!allowed || save.isPending}>
        <legend>{t('designer.campaign.settings')}</legend>
        <Input
          label={t('designer.workspace.name')}
          value={name}
          required
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Textarea
          label={t('designer.workspace.description')}
          value={description}
          maxLength={2000}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <Select
          label={t('designer.campaign.status')}
          value={status}
          onValueChange={(value) => {
            setStatus(CampaignSchema.shape.status.parse(value));
          }}
          options={['draft', 'active', 'paused', 'archived'].map((value) => ({
            value,
            label: t(`designer.workspace.status.${value}`),
          }))}
        />
        <MultiSelect
          label={t('designer.workspace.channels')}
          value={channels}
          onValueChange={setChannels}
          options={['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'video', 'callback'].map(
            (value) => ({ value, label: t(`designer.editor.channels.${value}`) }),
          )}
        />
        <Input
          label={t('designer.campaign.defaultLocale')}
          value={locale}
          required
          onChange={(e) => {
            setLocale(e.target.value);
          }}
        />
        <Input
          label={t('designer.campaign.locales')}
          value={locales}
          onChange={(e) => {
            setLocales(e.target.value);
          }}
        />
        <Input
          label={t('designer.campaign.queues')}
          value={queues}
          onChange={(e) => {
            setQueues(e.target.value);
          }}
        />
        <h2>{t('designer.campaign.outcomes')}</h2>
        {outcomes.map((outcome, index) => (
          <fieldset key={index}>
            <legend>{t('designer.campaign.outcomeNumber', { number: index + 1 })}</legend>
            <Input
              label={t('designer.campaign.code')}
              required
              value={outcome.code}
              maxLength={64}
              onChange={(e) => {
                update(index, { code: e.target.value });
              }}
            />
            <Input
              label={t('designer.campaign.label')}
              required
              value={outcome.label}
              maxLength={200}
              onChange={(e) => {
                update(index, { label: e.target.value });
              }}
            />
            <Select
              label={t('designer.campaign.category')}
              value={outcome.category}
              onValueChange={(value) => {
                update(index, { category: Outcome.shape.category.parse(value) });
              }}
              options={['success', 'failure', 'callback', 'noContact', 'other'].map((value) => ({
                value,
                label: t(`designer.campaign.categories.${value}`),
              }))}
            />
            <Checkbox
              label={t('designer.campaign.requiresNote')}
              checked={outcome.requiresNote}
              onCheckedChange={(value) => {
                update(index, { requiresNote: value === true });
              }}
            />
            <Input
              label={t('designer.campaign.requiredFields')}
              value={outcome.required}
              onChange={(e) => {
                update(index, { required: e.target.value });
              }}
            />
            <Input
              label={t('designer.campaign.subCodes')}
              value={outcome.subs}
              onChange={(e) => {
                update(index, { subs: e.target.value });
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOutcomes((rows) => rows.filter((_, i) => i !== index));
              }}
            >
              {t('designer.campaign.remove')}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={outcomes.length >= 200}
          onClick={() => {
            setOutcomes((rows) => [
              ...rows,
              {
                code: '',
                label: '',
                category: 'success',
                requiresNote: false,
                requiredFields: [],
                subCodes: [],
                required: '',
                subs: '',
              },
            ]);
          }}
        >
          {t('designer.campaign.add')}
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!allowed || !name.trim()}>
          {t('designer.campaign.save')}
        </Button>
      </fieldset>
      {save.isError && <Alert tone="danger" title={t('designer.campaign.failed')} />}
      {save.isSuccess && <p role="status">{t('designer.campaign.saved')}</p>}
    </form>
  );
}
