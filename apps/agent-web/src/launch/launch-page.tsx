import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { AppShell } from '@verbis/ui';

import { linkStatusFrom, openLinkPopup } from './genesys-link.js';
import { useLaunch } from './use-launch.js';

export function LaunchPage({ navigate }: { navigate: (path: string) => void }) {
  const { t } = useTranslation();
  const state = useLaunch({ navigate });
  const retry = state.status === 'denied' ? state.retry : undefined;
  const connectorId = state.status === 'denied' ? state.connectorId : undefined;
  useEffect(() => {
    if (retry === undefined) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (linkStatusFrom(event, window.location.origin) === 'linked') retry();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [retry]);
  const message =
    state.status === 'denied'
      ? t(
          state.code === 'VERBIS_LAUNCH_RATE_LIMITED'
            ? 'agent.launch.rateLimited'
            : state.code === 'VERBIS_LAUNCH_NO_ASSIGNMENT'
              ? 'agent.launch.noAssignment'
              : 'agent.launch.denied',
        )
      : t(`agent.launch.${state.status}`);
  const failed = ['denied', 'signedOut', 'breakGlass', 'noLaunch'].includes(state.status);
  const canLink =
    state.status === 'denied' && state.code === 'VERBIS_LAUNCH_DENIED' && connectorId !== undefined;
  return (
    <AppShell
      productName={t('common.productName')}
      appName={t('agent.hello.appName')}
      skipLinkLabel={t('common.skipToContent')}
    >
      <section
        className="vb-card"
        aria-labelledby="launch-title"
        aria-busy={state.status === 'checking' || state.status === 'launching'}
      >
        <h1 id="launch-title">{t('agent.launch.title')}</h1>
        <p role={failed ? 'alert' : 'status'}>{message}</p>
        {state.status === 'denied' && state.correlationId && (
          <p>
            {t('agent.desktop.supportCode')}: <code>{state.correlationId}</code>
          </p>
        )}
        {canLink ? (
          <>
            <p>{t('agent.launch.genesysLinkHint')}</p>
            <div className="vb-stack">
              <button
                type="button"
                className="vb-button"
                onClick={() => openLinkPopup(connectorId)}
              >
                {t('agent.launch.genesysLink')}
              </button>
              {retry === undefined ? null : (
                <button type="button" className="vb-button" onClick={retry}>
                  {t('agent.launch.retry')}
                </button>
              )}
            </div>
          </>
        ) : null}
      </section>
    </AppShell>
  );
}
