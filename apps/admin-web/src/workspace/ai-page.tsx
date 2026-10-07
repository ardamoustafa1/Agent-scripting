import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AiConfigSchema,
  AiSettingsSchema,
  AiUsageSchema,
  type AiConfig,
} from '@verbis/shared-types';
import { Alert, Button, Checkbox, Input, Select } from '@verbis/ui';

import { ListSchema, request, useAdmin, useResource } from './api.js';

export default function AiSettings() {
  const session = useAdmin(),
    { t } = useTranslation(),
    settings = useResource('/v1/ai/settings', AiSettingsSchema),
    usage = useResource('/v1/ai/usage', AiUsageSchema, true);
  const secrets = useResource('/v1/secrets', ListSchema);
  const [override, setConfig] = useState<AiConfig | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const config = override ?? settings.data?.config ?? AiConfigSchema.parse({});
  const endpoint = settings.data?.endpoints.find((e) => e.id === config.endpointId);
  if (!settings.data) return <p role="status">{t(settings.isError ? 'ai.error' : 'ai.loading')}</p>;
  return (
    <section>
      <h1>{t('ai.title')}</h1>
      <p>{t('ai.review')}</p>
      {!settings.data.available && <Alert title={t('ai.disabled')} />}
      <form
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 'var(--vb-space-4)',
          maxInlineSize: 720,
        }}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(false);
          setSaved(false);
          void request('/v1/ai/settings', AiSettingsSchema, {
            method: 'PUT',
            csrf: session.csrfToken,
            body: { version: settings.data.version, config },
          })
            .then(() => {
              setSaved(true);
              void settings.refetch();
            })
            .catch(() => {
              setError(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <Checkbox
          label={t('ai.enabled')}
          checked={config.enabled}
          onCheckedChange={(enabled) => {
            setConfig({ ...config, enabled: enabled === true });
          }}
        />
        <Checkbox
          label={t('ai.agentEnabled')}
          checked={config.agentEnabled}
          onCheckedChange={(value) => {
            setConfig({ ...config, agentEnabled: value === true });
          }}
        />
        <Select
          label={t('ai.provider')}
          value={config.endpointId}
          options={settings.data.endpoints.map((e) => ({
            value: e.id,
            label: `${e.provider} · ${e.residency} · ${e.id}`,
          }))}
          onValueChange={(endpointId) => {
            const e = settings.data.endpoints.find((x) => x.id === endpointId);
            setConfig({ ...config, endpointId, model: e?.models[0] ?? 'unconfigured' });
          }}
        />
        <Select
          label={t('ai.model')}
          value={config.model}
          options={(endpoint?.models ?? []).map((value) => ({ value, label: value }))}
          onValueChange={(model) => {
            setConfig({ ...config, model });
          }}
        />
        <Select
          label={t('ai.secret')}
          value={config.secretRef ?? 'unconfigured'}
          options={[
            { value: 'unconfigured', label: t('ai.unknown') },
            ...(secrets.data?.data ?? []).map((secret) => ({
              value: secret.id,
              label: typeof secret['name'] === 'string' ? secret['name'] : secret.id,
            })),
          ]}
          onValueChange={(value) => {
            setConfig({ ...config, secretRef: value === 'unconfigured' ? null : value });
          }}
        />
        {(
          [
            'monthlyTokens',
            'monthlyMicroUsd',
            'inputMicroUsdPerMillion',
            'outputMicroUsdPerMillion',
            'maxOutputTokens',
          ] as const
        ).map((key, index) => (
          <Input
            key={key}
            type="number"
            min={key === 'maxOutputTokens' ? 128 : 0}
            label={t(
              'ai.' +
                (['tokens', 'budget', 'inputRate', 'outputRate', 'maxOutput'][index] ?? 'tokens'),
            )}
            value={config[key]}
            onChange={(e) => {
              setConfig({ ...config, [key]: Number(e.target.value) });
            }}
          />
        ))}
        <Button
          type="submit"
          loading={busy}
          disabled={busy || !AiConfigSchema.safeParse(config).success}
        >
          {t('ai.save')}
        </Button>
        {error && <Alert tone="danger" title={t('ai.error')} />}{' '}
        {saved && <p role="status">{t('ai.saved')}</p>}
      </form>
      <h2>{t('ai.usage')}</h2>
      <Button
        onClick={() => {
          void request('/v1/ai/reconcile', AiUsageSchema.pick({}).loose(), {
            method: 'POST',
            csrf: session.csrfToken,
            body: {},
          })
            .then(() => usage.refetch())
            .catch(() => {
              setError(true);
            });
        }}
      >
        {t('ai.reconcile')}
      </Button>
      {usage.data && (
        <dl>
          {[
            ['tokens', `${usage.data.tokens} / ${usage.data.quotaTokens}`],
            ['budget', `${usage.data.microUsd} / ${usage.data.quotaMicroUsd}`],
            ['calls', usage.data.calls],
            ['pending', usage.data.pending],
          ].map(([key, value]) => (
            <div key={key}>
              <dt>{t('ai.' + String(key ?? 'tokens'))}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
