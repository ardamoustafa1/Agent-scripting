import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useCan } from './access.js';
import { useResource, useWrite } from './api.js';
import { Action, Card, Feedback, Field, useLabels } from './widgets.js';

const StatsSchema = z.object({
  durable: z.boolean(),
  persisted: z.number(),
  persistFailures: z.number(),
});
const ReplaySchema = z.object({ replayed: z.number() });

/** Connector hub DLQ (ADR-0041): counters + confirmed, tenant-scoped replay through the API (BFF). */
export function DeadLettersSection() {
  const can = useCan();
  return can('read', 'Connector') ? <DeadLettersBody /> : null;
}
function DeadLettersBody() {
  const l = useLabels(),
    { t } = useTranslation(),
    can = useCan(),
    write = useWrite(),
    [limit, setLimit] = useState('100'),
    [replayed, setReplayed] = useState<number>();
  const query = useResource('/v1/connector-dead-letters', StatsSchema, true);
  const parsed = Number(limit),
    valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000;
  return (
    <Card title={l('deadLetters')}>
      <p>{l('deadLettersHint')}</p>
      <Feedback error={query.error} />
      {query.data ? (
        <div className="aw-stats">
          <div>
            <span>{l('deadLettersDurable')}</span>
            <strong>{query.data.durable ? l('yes') : l('no')}</strong>
          </div>
          <div>
            <span>{l('deadLettersPersisted')}</span>
            <strong>{query.data.persisted}</strong>
          </div>
          <div>
            <span>{l('deadLettersPersistFailures')}</span>
            <strong>{query.data.persistFailures}</strong>
          </div>
        </div>
      ) : null}
      {can('manage', 'Connector') ? (
        <>
          <Field
            label={l('deadLettersReplayLimit')}
            type="number"
            value={limit}
            onChange={setLimit}
          />
          <Action
            label={l('deadLettersReplay')}
            danger
            disabled={!valid || !query.data || query.isFetching || query.isError}
            run={async () => {
              const result = ReplaySchema.parse(
                await write('/v1/connector-dead-letters/replay', { limit: parsed }),
              );
              setReplayed(result.replayed);
            }}
          />
          {replayed === undefined ? null : (
            <p role="status">{t('adminWorkspace.deadLettersReplayed', { total: replayed })}</p>
          )}
        </>
      ) : null}
    </Card>
  );
}
