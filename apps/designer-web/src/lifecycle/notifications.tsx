import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { NotificationSchema } from '@verbis/shared-types';
import { Alert, Badge } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

export function Notifications() {
  const { t } = useTranslation(),
    { session } = useWorkspace();
  const query = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'notifications',
    ],
    queryFn: ({ signal }) =>
      request('/v1/authoring-notifications', z.array(NotificationSchema), { signal }),
    refetchInterval: 30000,
  });
  return (
    <>
      {query.isError && <Alert tone="danger" title={t('designer.lifecycle.failed')} />}
      <ul>
        {query.data?.map((row) => (
          <li key={row.id}>
            <Link
              to={`/scripts/${row.scriptId}/versions/${row.number}/release${row.threadId ? `?thread=${row.threadId}` : ''}`}
            >
              <Badge tone={row.kind === 'mention' ? 'info' : 'warning'}>
                {t(`designer.lifecycle.notifications.${row.kind}`)}
              </Badge>{' '}
              {t('designer.lifecycle.versionLabel', { number: row.number })}
            </Link>
          </li>
        ))}
      </ul>
      {query.data?.length === 0 && <p>{t('designer.workspace.notificationsEmpty')}</p>}
    </>
  );
}
