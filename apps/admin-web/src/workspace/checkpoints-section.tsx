import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Alert, DataTable } from '@verbis/ui';

import { download, useResource } from './api.js';
import { Action } from './widgets.js';

const Checkpoint = z.object({
  id: z.string(),
  seq: z.string(),
  hash: z.string(),
  sessionHeadsCount: z.number(),
  keyId: z.string(),
  signedAt: z.string(),
});
type Checkpoint = z.infer<typeof Checkpoint>;
const Keys = z.object({
  keys: z.array(z.object({ kid: z.string(), kty: z.string(), crv: z.string() })),
});
const STALE_HOURS = 24;
const shortHash = (hash: string) => `${hash.slice(0, 16)}…`;

/** Signed audit checkpoints and the public keys that verify them offline (ADR-0017). */
export function CheckpointsSection({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation(),
    list = useResource('/v1/audit-checkpoints', z.array(Checkpoint)),
    keys = useResource('/v1/audit-checkpoints/keys', Keys),
    time = (iso: string) =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      );
  const rows = list.data ?? [],
    latest = rows[0];
  const stale =
    latest !== undefined &&
    now.getTime() - new Date(latest.signedAt).getTime() > STALE_HOURS * 3_600_000;
  return (
    <article aria-labelledby="trust-checkpoints">
      <h2 id="trust-checkpoints">{t('trust.checkpoints.title')}</h2>
      <p>{t('trust.checkpoints.intro')}</p>
      {list.isError || keys.isError ? <Alert title={t('trust.checkpoints.error')} /> : null}
      {list.isPending ? <p>{t('trust.loading')}</p> : null}
      {list.data && rows.length === 0 ? <p>{t('trust.checkpoints.none')}</p> : null}
      {stale ? (
        <Alert
          tone="warning"
          title={t('trust.checkpoints.stale', { hours: STALE_HOURS, date: time(latest.signedAt) })}
        />
      ) : null}
      {rows.length > 0 ? (
        <DataTable
          label={t('trust.checkpoints.title')}
          data={rows}
          getRowId={(row: Checkpoint) => row.id}
          columns={[
            {
              id: 'signedAt',
              header: t('trust.checkpoints.signedAt'),
              accessor: (row: Checkpoint) => row.signedAt,
              cell: (row: Checkpoint) => <time dateTime={row.signedAt}>{time(row.signedAt)}</time>,
            },
            {
              id: 'seq',
              header: t('trust.checkpoints.seq'),
              accessor: (row: Checkpoint) => row.seq,
            },
            {
              id: 'sessions',
              header: t('trust.checkpoints.sessions'),
              accessor: (row: Checkpoint) => String(row.sessionHeadsCount),
            },
            {
              id: 'keyId',
              header: t('trust.checkpoints.keyId'),
              accessor: (row: Checkpoint) => row.keyId,
            },
            {
              id: 'hash',
              header: t('trust.checkpoints.hash'),
              accessor: (row: Checkpoint) => row.hash,
              cell: (row: Checkpoint) => <code title={row.hash}>{shortHash(row.hash)}</code>,
            },
          ]}
        />
      ) : null}
      <h3>{t('trust.checkpoints.keysTitle')}</h3>
      {keys.data?.keys.length === 0 ? (
        <Alert tone="warning" title={t('trust.checkpoints.noKeys')} />
      ) : null}
      {keys.data && keys.data.keys.length > 0 ? (
        <>
          <p>{t('trust.checkpoints.keysHint')}</p>
          <ul>
            {keys.data.keys.map((key) => (
              <li key={key.kid}>
                <code>{key.kid}</code> · {key.kty}/{key.crv}
              </li>
            ))}
          </ul>
          <Action
            label={t('trust.checkpoints.downloadKeys')}
            run={() => download('/v1/audit-checkpoints/keys', 'verbis-audit-checkpoint-keys.json')}
          />
        </>
      ) : null}
    </article>
  );
}
