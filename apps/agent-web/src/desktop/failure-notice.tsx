import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Button } from '@verbis/ui';

import type { AgentFailure } from './failure.js';

export function FailureNotice({
  failure,
  children,
}: {
  failure: AgentFailure;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Alert tone="danger" title={t(`agent.desktop.failure.${failure.kind}`)}>
      <p>
        {t('agent.desktop.supportCode')}: <code>{failure.correlationId}</code>
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          if (!('clipboard' in navigator)) return;
          void navigator.clipboard
            .writeText(failure.correlationId)
            .then(() => {
              setCopied(true);
            })
            .catch(() => {
              setCopied(false);
            });
        }}
      >
        {t('agent.desktop.copySupportCode')}
      </Button>
      {copied && <p role="status">{t('agent.desktop.supportCodeCopied')}</p>}
      {children}
    </Alert>
  );
}
