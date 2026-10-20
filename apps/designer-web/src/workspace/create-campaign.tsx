import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { asSubject } from '@verbis/authz';
import { useAbility } from '@verbis/authz/react';
import { Alert, Button } from '@verbis/ui';

import { PageSchema, request } from '../api/client.js';

import { useWorkspace } from './context.js';

export function useCreateCampaigns(enabled: boolean) {
  const { session } = useWorkspace();
  const ability = useAbility();
  return useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'create-campaigns',
    ],
    enabled,
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
}

export function CreateCampaignPicker({
  campaigns,
  value,
  onChange,
}: {
  campaigns: ReturnType<typeof useCreateCampaigns>;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const { t } = useTranslation();
  return (
    <>
      <div className="vb-form-field">
        <label htmlFor={id}>{t('designer.workspace.createCampaign')}</label>
        <select
          id={id}
          className="vb-input"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          disabled={campaigns.isPending || campaigns.isError}
          required
          aria-describedby={`${id}-help`}
        >
          <option value="">{t('ui.select')}</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-help`}>{t('designer.workspace.createCampaignHelp')}</p>
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
  );
}
