import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchEngageLinks, openEngageLinkPopup } from './engage-links.js';
import { linkStatusFrom } from './genesys-link.js';

/**
 * Home card: Genesys Engage workspace connectors need one delegated link per shift so the hub can
 * follow this agent's own Workspace session. Scripts then open by themselves (s2s launch).
 */
export function EngageLinksCard() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const links = useQuery({ queryKey: ['engage-links'], queryFn: fetchEngageLinks, retry: false });
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (linkStatusFrom(event, window.location.origin) !== undefined)
        void client.invalidateQueries({ queryKey: ['engage-links'] });
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [client]);
  if (links.data === undefined || links.data.length === 0) return null;
  return (
    <section className="vb-card" aria-labelledby="engage-links-title">
      <h2 id="engage-links-title">{t('agent.engageLink.title')}</h2>
      <ul className="vb-stack">
        {links.data.map((link) => (
          <li key={link.connectorId}>
            {link.linked && link.expiresAt !== null ? (
              <p role="status">
                {t('agent.engageLink.linkedUntil', {
                  time: new Date(link.expiresAt).toLocaleTimeString(i18n.language),
                })}
              </p>
            ) : (
              <>
                <p>{t('agent.engageLink.hint')}</p>
                <button
                  type="button"
                  className="vb-button"
                  onClick={() => openEngageLinkPopup(link.connectorId)}
                >
                  {t('agent.engageLink.link')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
