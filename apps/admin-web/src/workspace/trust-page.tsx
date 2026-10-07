import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TrustCenterSchema, type TrustCenter } from '@verbis/shared-types';
import { Alert, SelectField, StatusBadge, type Status } from '@verbis/ui';

import { useResource } from './api.js';

const WINDOWS = ['7', '30', '90'] as const;
const STATUS: Record<TrustCenter['chain']['status'], Status> = {
  healthy: 'up',
  attention: 'unknown',
  broken: 'down',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="aw-trust-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function TrustCenterPage() {
  const { t, i18n } = useTranslation(),
    [days, setDays] = useState<(typeof WINDOWS)[number]>('30'),
    query = useResource(`/v1/trust-center?days=${days}`, TrustCenterSchema, true),
    number = new Intl.NumberFormat(i18n.language),
    time = (iso: string) =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      );
  if (query.isError) return <Alert title={t('trust.error')} />;
  const data = query.data;
  if (!data) return <p role="status">{t('trust.loading')}</p>;
  const { chain, launch, sensitiveAccess, privacy } = data;
  return (
    <section aria-labelledby="trust-title" className="aw-trust">
      <h1 id="trust-title">{t('trust.title')}</h1>
      <p>{t('trust.scope')}</p>
      <SelectField
        label={t('trust.window')}
        value={days}
        options={WINDOWS.map((value) => ({
          value,
          label: t('trust.days', { count: Number(value) }),
        }))}
        onChange={setDays}
      />
      <article aria-labelledby="trust-chain">
        <h2 id="trust-chain">{t('trust.chain')}</h2>
        <StatusBadge
          status={STATUS[chain.status]}
          label={t('trust.chainStatus')}
          statusText={t(`trust.status.${chain.status}`)}
        />
        <p>{t(`trust.statusHint.${chain.status}`)}</p>
        <dl>
          <Row label={t('trust.checked')} value={number.format(chain.checked)} />
          <Row label={t('trust.breaks')} value={number.format(chain.breaks)} />
          <Row
            label={t('trust.signatures')}
            value={t(chain.signaturesVerified ? 'trust.yes' : 'trust.no')}
          />
          <Row label={t('trust.truncated')} value={t(chain.truncated ? 'trust.yes' : 'trust.no')} />
          <Row
            label={t('trust.latestCheckpoint')}
            value={
              chain.latestCheckpoint
                ? `#${chain.latestCheckpoint.seq} · ${time(chain.latestCheckpoint.signedAt)}`
                : t('trust.none')
            }
          />
        </dl>
      </article>
      <article aria-labelledby="trust-launch">
        <h2 id="trust-launch">{t('trust.launch')}</h2>
        <dl>
          <Row label={t('trust.launchIssued')} value={number.format(launch.issued)} />
          <Row label={t('trust.launchRedeemed')} value={number.format(launch.redeemed)} />
          <Row label={t('trust.launchDenied')} value={number.format(launch.denied)} />
          <Row label={t('trust.launchAnomalies')} value={number.format(launch.anomalies)} />
          <Row label={t('trust.launchUrlParams')} value={number.format(launch.urlParamsRejected)} />
        </dl>
      </article>
      <article aria-labelledby="trust-access">
        <h2 id="trust-access">{t('trust.access')}</h2>
        <p>{t('trust.accessHint')}</p>
        <dl>
          <Row
            label={t('trust.auditExports')}
            value={number.format(sensitiveAccess.auditExports)}
          />
          <Row
            label={t('trust.secretViews')}
            value={number.format(sensitiveAccess.secretMetadataViews)}
          />
          <Row
            label={t('trust.secretUsage')}
            value={number.format(sensitiveAccess.secretUsageReads)}
          />
          <Row
            label={t('trust.userViews')}
            value={number.format(sensitiveAccess.userProfileViews)}
          />
          <Row
            label={t('trust.privacyExports')}
            value={number.format(sensitiveAccess.privacyExports)}
          />
        </dl>
      </article>
      <article aria-labelledby="trust-privacy">
        <h2 id="trust-privacy">{t('trust.privacy')}</h2>
        <dl>
          <Row label={t('trust.privacyOpen')} value={number.format(privacy.open)} />
          <Row label={t('trust.privacyProcessed')} value={number.format(privacy.processed)} />
          <Row
            label={t('trust.privacyOldest')}
            value={privacy.oldestOpenAt ? time(privacy.oldestOpenAt) : t('trust.none')}
          />
        </dl>
      </article>
      <p>
        {t('trust.generated')} <time dateTime={data.generatedAt}>{time(data.generatedAt)}</time>
      </p>
    </section>
  );
}
