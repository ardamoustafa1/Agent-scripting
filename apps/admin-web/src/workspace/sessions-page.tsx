import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Alert, Badge } from '@verbis/ui';

import { request, useAdmin, useResource, useWrite } from './api.js';
import { Action, Card, Feedback, useLabels } from './widgets.js';

const Session = z.object({
  id: z.string(),
  kind: z.enum(['sso', 'break_glass']),
  protocol: z.enum(['oidc', 'saml', 'local']),
  app: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  ip: z.string(),
  userAgent: z.string(),
  current: z.boolean(),
});
type Session = z.infer<typeof Session>;
const List = z.object({ data: z.array(Session) });

/** "Chrome on macOS" from a user agent string; unknown agents are shortened, never echoed whole. */
export function describeAgent(agent: string): { browser: string; system: string } {
  const browser = agent.includes('Edg/')
      ? 'Edge'
      : /OPR\/|Opera/.test(agent)
        ? 'Opera'
        : agent.includes('Firefox/')
          ? 'Firefox'
          : agent.includes('Chrome/')
            ? 'Chrome'
            : agent.includes('Safari/')
              ? 'Safari'
              : '',
    system = agent.includes('Windows')
      ? 'Windows'
      : /iPhone|iPad|iOS/.test(agent)
        ? 'iOS'
        : agent.includes('Android')
          ? 'Android'
          : /Mac OS X|Macintosh/.test(agent)
            ? 'macOS'
            : agent.includes('Linux')
              ? 'Linux'
              : '';
  return { browser: browser || agent.slice(0, 40) || '', system };
}

export default function MySessions() {
  const l = useLabels(),
    { t, i18n } = useTranslation(),
    session = useAdmin(),
    write = useWrite(),
    query = useResource('/v1/me/sessions', List, true);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const rows = query.data?.data ?? [];
  const others = rows.filter((row) => !row.current);
  return (
    <Card title={l('account.title')}>
      <p>{l('account.intro')}</p>
      <Feedback error={query.error} />
      {query.isPending ? <p>{l('loading')}</p> : null}
      <ul className="aw-sp-list">
        {rows.map((row) => {
          const agent = describeAgent(row.userAgent);
          return (
            <li key={row.id}>
              <div className="aw-sp-head">
                <strong>
                  {t(`adminWorkspace.account.app.${row.app}`, { defaultValue: row.app })}
                </strong>
                {row.current ? <Badge tone="success">{l('account.thisDevice')}</Badge> : null}
                {row.kind === 'break_glass' ? (
                  <Badge tone="warning">{l('account.breakGlass')}</Badge>
                ) : null}
              </div>
              <dl className="aw-secret">
                <dt>{l('account.device')}</dt>
                <dd>
                  {[agent.browser, agent.system].filter(Boolean).join(' · ') ||
                    l('account.unknownDevice')}
                </dd>
                <dt>{l('account.method')}</dt>
                <dd>{t(`adminWorkspace.enum.protocol.${row.protocol}`)}</dd>
                <dt>{l('account.address')}</dt>
                <dd>
                  <code>{row.ip}</code>
                </dd>
                <dt>{l('account.signedIn')}</dt>
                <dd>{when(row.createdAt)}</dd>
                <dt>{l('account.lastActive')}</dt>
                <dd>{when(row.lastSeenAt)}</dd>
                <dt>{l('account.expires')}</dt>
                <dd>{when(row.expiresAt)}</dd>
              </dl>
              {row.current ? (
                <p className="aw-hint">{l('account.currentHint')}</p>
              ) : (
                <Action
                  label={l('account.end')}
                  danger
                  run={() => write(`/v1/me/sessions/${row.id}`, undefined, 'DELETE')}
                />
              )}
            </li>
          );
        })}
      </ul>
      {query.data && rows.length === 0 ? <Alert title={l('account.none')} /> : null}
      {others.length > 0 ? (
        <>
          <h3>{l('account.endAllTitle')}</h3>
          <p>{l('account.endAllHint')}</p>
          <Action
            label={t('adminWorkspace.account.endAll', { count: others.length })}
            danger
            run={async () => {
              await request('/v1/me/sessions', z.unknown(), {
                method: 'DELETE',
                csrf: session.csrfToken,
              });
              await query.refetch();
            }}
          />
        </>
      ) : null}
    </Card>
  );
}
