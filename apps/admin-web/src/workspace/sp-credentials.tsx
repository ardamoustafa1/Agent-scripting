import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Alert, Badge, Button } from '@verbis/ui';

import { useCan } from './access.js';
import { record, useWrite, type Row } from './api.js';
import { Action, useEnumLabel, useLabels } from './widgets.js';

const Credential = z.object({
  id: z.string(),
  use: z.enum(['signing', 'encryption']),
  state: z.enum(['active', 'next', 'retired']),
  certificate: z.string(),
  notAfter: z.string(),
});
type Credential = z.infer<typeof Credential>;

const ORDER = { active: 0, next: 1, retired: 2 } as const;
const SOON_DAYS = 30;
const TONE = { active: 'success', next: 'info', retired: 'neutral' } as const;

/** PEM text of a certificate stored as bare base64 or already armoured. */
export function toPem(certificate: string): string {
  if (certificate.includes('BEGIN CERTIFICATE')) return certificate;
  const lines = certificate.replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function savePem(credential: Credential) {
  const url = URL.createObjectURL(
    new Blob([toPem(credential.certificate)], { type: 'application/x-pem-file' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `sp-${credential.use}-${credential.state}.pem`;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * SAML service-provider certificates (signing and encryption). A new one is published as `next`
 * in the SP metadata first, so the identity provider can trust it before it is promoted.
 */
export function SpCredentials({ row, now = new Date() }: { row: Row; now?: Date }) {
  const l = useLabels(),
    { t, i18n } = useTranslation(),
    can = useCan(),
    write = useWrite(),
    enumLabel = useEnumLabel(),
    parsed = z.array(Credential).safeParse(record(row['config'])['spCredentials']),
    credentials = (parsed.success ? parsed.data : []).toSorted(
      (a, b) => a.use.localeCompare(b.use) || ORDER[a.state] - ORDER[b.state],
    ),
    editable = can('manage', 'IdentityProvider') || can('update', 'Idp');
  const base = `/v1/identity-providers/${row.id}/sp-credentials`;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));
  const soon = credentials.filter(
    (c) =>
      c.state === 'active' &&
      new Date(c.notAfter).getTime() - now.getTime() < SOON_DAYS * 86_400_000,
  );
  const hasNext = (use: Credential['use']) =>
    credentials.some((c) => c.use === use && c.state === 'next');
  return (
    <section aria-labelledby={`sp-${row.id}`}>
      <h3 id={`sp-${row.id}`}>{l('sp.title')}</h3>
      <p>{l('sp.intro')}</p>
      {soon.map((c) => (
        <Alert
          key={c.id}
          tone="warning"
          title={t('adminWorkspace.sp.expiresSoon', {
            use: enumLabel('spUse', c.use),
            date: date(c.notAfter),
          })}
        />
      ))}
      {credentials.length === 0 ? <p>{l('sp.none')}</p> : null}
      <ul className="aw-sp-list">
        {credentials.map((c) => (
          <li key={c.id}>
            <div className="aw-sp-head">
              <strong>{enumLabel('spUse', c.use)}</strong>
              <Badge tone={TONE[c.state]}>{enumLabel('spState', c.state)}</Badge>
              <span>{t('adminWorkspace.sp.validUntil', { date: date(c.notAfter) })}</span>
            </div>
            <div className="aw-inline">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  savePem(c);
                }}
              >
                {l('sp.download')}
              </Button>
              {c.state === 'next' ? (
                <Action
                  label={l('sp.promote')}
                  danger
                  disabled={!editable}
                  run={() => write(`${base}/${c.id}/promote`, {})}
                />
              ) : null}
              {c.state !== 'active' ? (
                <Action
                  label={l('sp.remove')}
                  danger
                  disabled={!editable}
                  run={() => write(`${base}/${c.id}`, undefined, 'DELETE')}
                />
              ) : null}
            </div>
            {c.state === 'next' ? <p className="aw-hint">{l('sp.promoteHint')}</p> : null}
          </li>
        ))}
      </ul>
      <div className="aw-inline">
        {(['signing', 'encryption'] as const).map((use) => (
          <Action
            key={use}
            label={t('adminWorkspace.sp.add', { use: enumLabel('spUse', use) })}
            disabled={!editable || hasNext(use)}
            run={() => write(base, { use })}
          />
        ))}
      </div>
      {hasNext('signing') || hasNext('encryption') ? (
        <p className="aw-hint">{l('sp.alreadyNext')}</p>
      ) : null}
    </section>
  );
}
