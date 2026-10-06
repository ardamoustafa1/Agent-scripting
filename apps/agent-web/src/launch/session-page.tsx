import { useTranslation } from 'react-i18next';

/**
 * /s/{sessionId}: the id is not a capability. The API serves the session only to its bound user
 * (BFF cookie + owner check); the runtime renderer lands here in step 25.
 */
export function SessionPage({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  return (
    <section className="vb-card" aria-labelledby="session-title" data-session-id={sessionId}>
      <h1 id="session-title">{t('agent.session.title')}</h1>
      <p>{t('agent.session.pending')}</p>
    </section>
  );
}
