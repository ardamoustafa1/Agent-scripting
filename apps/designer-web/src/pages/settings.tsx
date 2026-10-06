import { useTranslation } from 'react-i18next';

import { Alert, Badge } from '@verbis/ui';

import { useWorkspace } from '../workspace/context.js';

export default function Settings() {
  const { t } = useTranslation();
  const { session, environment } = useWorkspace();
  return (
    <section>
      <div className="dw-page-heading">
        <div>
          <h1>{t('designer.workspace.nav.settings')}</h1>
          <p>{t('designer.workspace.descriptions.settings')}</p>
        </div>
      </div>
      <div className="dw-detail-summary">
        <div>
          <span>{t('designer.workspace.tenant')}</span>
          <strong>{session.user.tenantId}</strong>
        </div>
        <div>
          <span>{t('designer.workspace.environment')}</span>
          <Badge>{t(`designer.workspace.env.${environment}`)}</Badge>
        </div>
      </div>
      <Alert title={t('designer.workspace.ssoManaged')}>
        {t('designer.workspace.settingsDetail')}
      </Alert>
    </section>
  );
}
