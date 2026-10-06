import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  genesysMappings,
  GenesysIdSchema,
  listCampaigns,
  MAPPING_KINDS,
  MappingApiError,
  nextMappings,
  saveMappings,
  type CampaignSummary,
  type ExternalMapping,
  type MappingKind,
} from './genesys-mapping-api.js';

const errorKey = (error: unknown) => {
  const code = error instanceof MappingApiError ? error.code : '';
  if (code === 'VERBIS_RESOURCE_CONFLICT' || code === 'VERBIS_HTTP_CONFLICT')
    return 'admin.genesysMapping.error.conflict';
  if (code === 'VERBIS_VALIDATION_FAILED') return 'admin.genesysMapping.error.invalid';
  return 'admin.genesysMapping.error.generic';
};

/** Admin: bind Genesys Cloud queues and outbound campaigns to Verbis campaigns. */
export function GenesysMappingSection({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const campaigns = useQuery({ queryKey: ['genesys-campaigns'], queryFn: listCampaigns });
  const [campaignId, setCampaignId] = useState('');
  const [kind, setKind] = useState<MappingKind>('queue');
  const [externalId, setExternalId] = useState('');
  const [invalid, setInvalid] = useState(false);
  const selected = campaigns.data?.find((c) => c.id === campaignId) ?? campaigns.data?.[0];
  const save = useMutation({
    mutationFn: (input: { campaign: CampaignSummary; mappings: ExternalMapping[] }) =>
      saveMappings(input.campaign, input.mappings, csrfToken),
    onSuccess: () => {
      setExternalId('');
      return client.invalidateQueries({ queryKey: ['genesys-campaigns'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selected === undefined) return;
    if (!GenesysIdSchema.safeParse(externalId.trim().toLowerCase()).success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({
      campaign: selected,
      mappings: nextMappings(selected, { add: { kind, externalId } }),
    });
  };

  const rows = (campaigns.data ?? []).flatMap((campaign) =>
    genesysMappings(campaign).map((mapping) => ({ campaign, mapping })),
  );

  return (
    <section className="vb-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('admin.genesysMapping.title')}</h2>
      <p>{t('admin.genesysMapping.description')}</p>
      {campaigns.isSuccess && campaigns.data.length === 0 ? (
        <p role="status">{t('admin.genesysMapping.noCampaigns')}</p>
      ) : null}
      {selected === undefined ? null : (
        <form className="vb-stack" onSubmit={submit} noValidate>
          <label className="vb-form-field" htmlFor={`${id}-campaign`}>
            {t('admin.genesysMapping.campaign')}
            <select
              id={`${id}-campaign`}
              className="vb-input"
              value={selected.id}
              onChange={(e) => {
                setCampaignId(e.target.value);
              }}
            >
              {(campaigns.data ?? []).map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>
          <label className="vb-form-field" htmlFor={`${id}-kind`}>
            {t('admin.genesysMapping.kind')}
            <select
              id={`${id}-kind`}
              className="vb-input"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as MappingKind);
              }}
            >
              {MAPPING_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(
                    value === 'queue'
                      ? 'admin.genesysMapping.kindQueue'
                      : 'admin.genesysMapping.kindCampaign',
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="vb-form-field" htmlFor={`${id}-external`}>
            {t('admin.genesysMapping.externalId')}
            <input
              id={`${id}-external`}
              className="vb-input"
              required
              maxLength={36}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby={invalid ? `${id}-invalid` : undefined}
              value={externalId}
              onChange={(e) => {
                setExternalId(e.target.value);
              }}
            />
          </label>
          {invalid ? (
            <p id={`${id}-invalid`} className="vb-alert" role="alert">
              {t('admin.genesysMapping.error.invalid')}
            </p>
          ) : null}
          <button className="vb-button" type="submit" disabled={save.isPending}>
            {t('admin.genesysMapping.add')}
          </button>
          {save.isError ? (
            <p className="vb-alert" role="alert">
              {t(errorKey(save.error))}
            </p>
          ) : null}
          {save.isSuccess ? <p role="status">{t('admin.genesysMapping.saved')}</p> : null}
        </form>
      )}
      {rows.length === 0 ? (
        campaigns.isSuccess ? (
          <p>{t('admin.genesysMapping.empty')}</p>
        ) : null
      ) : (
        <ul aria-label={t('admin.genesysMapping.listLabel')} className="vb-stack">
          {rows.map(({ campaign, mapping }) => (
            <li key={`${campaign.id}:${mapping.kind}:${mapping.externalId}`}>
              <span>
                {campaign.name} ·{' '}
                {t(
                  mapping.kind === 'queue'
                    ? 'admin.genesysMapping.kindQueue'
                    : 'admin.genesysMapping.kindCampaign',
                )}{' '}
                · <code>{mapping.externalId}</code>
              </span>{' '}
              <button
                type="button"
                className="vb-button"
                disabled={save.isPending}
                aria-label={t('admin.genesysMapping.remove', { externalId: mapping.externalId })}
                onClick={() => {
                  save.mutate({ campaign, mappings: nextMappings(campaign, { remove: mapping }) });
                }}
              >
                {t('admin.genesysMapping.removeShort')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
