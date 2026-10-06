import { useMutation } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input, Button, Alert, AccessLayout } from '@verbis/ui';

import { request, DiscoverySchema, loginUrl } from '../api/client.js';

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const discovery = useMutation({
    mutationFn: (email: string) =>
      request('/auth/discover', DiscoverySchema, { method: 'POST', body: { email } }),
  });
  return (
    <AccessLayout appName={t('designer.workspace.studio')}>
      <h2 id="login-access-title">{t('designer.workspace.loginEntryTitle')}</h2>
      <p className="vb-access-form-description">{t('designer.workspace.loginEntryDescription')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!discovery.isPending) discovery.mutate(email);
        }}
      >
        <Input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          label={t('designer.workspace.workEmail')}
          placeholder={t('designer.workspace.loginEmailPlaceholder')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            discovery.reset();
          }}
        />
        <Button
          type="submit"
          loading={discovery.isPending}
          endIcon={<ArrowRight size={18} aria-hidden />}
        >
          {t('designer.workspace.continue')}
        </Button>
      </form>
      {discovery.isError && (
        <Alert tone="danger" title={t('designer.workspace.error')}>
          {t('designer.workspace.loginDiscoveryError')}
        </Alert>
      )}
      <div className="vb-access-provider-list" aria-live="polite">
        {discovery.data && discovery.data.providers.length > 0 && (
          <p className="vb-access-provider-hint">{t('designer.workspace.loginProviderHint')}</p>
        )}
        {discovery.data?.providers.map((provider) => (
          <a
            className="vb-button vb-access-provider"
            key={provider.id}
            href={loginUrl(discovery.data.tenant, provider.id)}
          >
            {provider.displayName}
            <ArrowUpRight size={16} aria-hidden />
          </a>
        ))}
        {discovery.data?.providers.length === 0 && (
          <Alert title={t('designer.workspace.noProvider')}>
            {t('designer.workspace.loginNoProviderHelp')}
          </Alert>
        )}
      </div>
    </AccessLayout>
  );
}
