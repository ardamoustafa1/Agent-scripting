import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { asSubject } from '@verbis/authz';
import { useCan, useAbility } from '@verbis/authz/react';
import { Button, Dialog, Input, Textarea, Alert } from '@verbis/ui';

import {
  request,
  ResourceSchema,
  PageSchema,
  ApiError,
  type CreateCampaign,
  type CreateScript,
} from '../api/client.js';

import { useWorkspace } from './context.js';

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
          create.mutate();
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
          loading={create.isPending}
          disabled={!name.trim() || (kind === 'scripts' && !selectedCampaign)}
        >
          {t('designer.workspace.create')}
        </Button>
      </form>
    </Dialog>
  );
}
