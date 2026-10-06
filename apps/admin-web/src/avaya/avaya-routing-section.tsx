import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listCampaigns,
  MappingApiError,
  saveMappings,
  type CampaignSummary,
  type ExternalMapping,
} from '../genesys/genesys-mapping-api.js';

import {
  AVAYA_PLATFORMS,
  AvayaIdSchema,
  avayaMappings,
  nextAvayaMappings,
  type AvayaPlatform,
} from './avaya-routing.js';

const PLATFORMS = Object.keys(AVAYA_PLATFORMS) as AvayaPlatform[];

/** Admin: bind Avaya VDNs, skills, skillsets, AXP queues and outbound campaigns to Verbis campaigns. */
export function AvayaRoutingSection({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const campaigns = useQuery({ queryKey: ['genesys-campaigns'], queryFn: listCampaigns });
  const [campaignId, setCampaignId] = useState('');
  const [platform, setPlatform] = useState<AvayaPlatform>('avaya-aes');
  const [kind, setKind] = useState<string>(AVAYA_PLATFORMS['avaya-aes'][0]);
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
  if (selected === undefined) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!AvayaIdSchema.safeParse(externalId).success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({
      campaign: selected,
      mappings: nextAvayaMappings(selected, platform, { add: { kind, externalId } }),
    });
  };
  const rows = (campaigns.data ?? []).flatMap((campaign) =>
    avayaMappings(campaign).map((mapping) => ({ campaign, mapping })),
  );
  const errorKey =
    save.error instanceof MappingApiError &&
    (save.error.code === 'VERBIS_RESOURCE_CONFLICT' || save.error.code === 'VERBIS_HTTP_CONFLICT')
      ? 'admin.avayaRouting.error.conflict'
      : 'admin.avayaRouting.error.generic';

  return (
    <section className="vb-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('admin.avayaRouting.title')}</h2>
      <p>{t('admin.avayaRouting.description')}</p>
      <form className="vb-stack" onSubmit={submit} noValidate>
        <label className="vb-form-field" htmlFor={`${id}-campaign`}>
          {t('admin.avayaRouting.campaign')}
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
        <label className="vb-form-field" htmlFor={`${id}-platform`}>
          {t('admin.avayaRouting.platform')}
          <select
            id={`${id}-platform`}
            className="vb-input"
            value={platform}
            onChange={(e) => {
              const next = e.target.value as AvayaPlatform;
              setPlatform(next);
              setKind(AVAYA_PLATFORMS[next][0]);
            }}
          >
            {PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {t(`admin.avayaRouting.platforms.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="vb-form-field" htmlFor={`${id}-kind`}>
          {t('admin.avayaRouting.kind')}
          <select
            id={`${id}-kind`}
            className="vb-input"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            {AVAYA_PLATFORMS[platform].map((value) => (
              <option key={value} value={value}>
                {t(`admin.avayaRouting.kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="vb-form-field" htmlFor={`${id}-external`}>
          {t('admin.avayaRouting.externalId')}
          <input
            id={`${id}-external`}
            className="vb-input"
            required
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
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
            {t('admin.avayaRouting.error.invalid')}
          </p>
        ) : null}
        <button className="vb-button" type="submit" disabled={save.isPending}>
          {t('admin.avayaRouting.add')}
        </button>
        {save.isError ? (
          <p className="vb-alert" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        {save.isSuccess ? <p role="status">{t('admin.avayaRouting.saved')}</p> : null}
      </form>
      {rows.length === 0 ? (
        <p>{t('admin.avayaRouting.empty')}</p>
      ) : (
        <ul aria-label={t('admin.avayaRouting.listLabel')} className="vb-stack">
          {rows.map(({ campaign, mapping }) => (
            <li key={`${campaign.id}:${mapping.platform}:${mapping.kind}:${mapping.externalId}`}>
              <span>
                {campaign.name} ·{' '}
                {t(`admin.avayaRouting.platforms.${mapping.platform as AvayaPlatform}`)} ·{' '}
                {t(`admin.avayaRouting.kinds.${mapping.kind as 'vdn'}`)} ·{' '}
                <code>{mapping.externalId}</code>
              </span>{' '}
              <button
                type="button"
                className="vb-button"
                disabled={save.isPending}
                aria-label={t('admin.avayaRouting.remove', { externalId: mapping.externalId })}
                onClick={() => {
                  save.mutate({
                    campaign,
                    mappings: nextAvayaMappings(campaign, mapping.platform as AvayaPlatform, {
                      remove: mapping,
                    }),
                  });
                }}
              >
                {t('admin.avayaRouting.removeShort')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
