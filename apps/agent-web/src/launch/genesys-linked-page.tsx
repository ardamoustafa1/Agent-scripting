import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppShell } from '@verbis/ui';

import { LINK_MESSAGE, parseLinkStatus, type LinkStatus } from './genesys-link.js';
import { scrubLocation } from './launch-fragment.js';

/** Popup landing page after the Genesys OAuth callback: notify the opener, then close. */
export function GenesysLinkedPage() {
  const { t } = useTranslation();
  const [status] = useState<LinkStatus>(() => parseLinkStatus(window.location.hash));
  useEffect(() => {
    scrubLocation();
    const opener = window.opener as Window | null;
    if (opener !== null) {
      opener.postMessage({ type: LINK_MESSAGE, status }, window.location.origin);
      window.close();
    }
  }, [status]);
  return (
    <AppShell
      productName={t('common.productName')}
      appName={t('agent.hello.appName')}
      skipLinkLabel={t('common.skipToContent')}
    >
      <section className="vb-card" aria-labelledby="genesys-linked-title">
        <h1 id="genesys-linked-title">{t('agent.genesysLinked.title')}</h1>
        <p role={status === 'linked' ? 'status' : 'alert'}>{t(`agent.genesysLinked.${status}`)}</p>
      </section>
    </AppShell>
  );
}
