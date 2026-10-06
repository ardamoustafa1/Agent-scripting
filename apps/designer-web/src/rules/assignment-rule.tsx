import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { PredicateSchema, type Predicate } from '@verbis/script-schema';
import { Button, Dialog, Alert } from '@verbis/ui';

import { request, ApiError } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

import { RuleBuilder } from './builder.js';

import type { RuleField } from './fields.js';

const Assignment = z.object({
  id: z.uuid(),
  version: z.number().int(),
  expression: PredicateSchema.nullable(),
});
const fields: RuleField[] = [
  ...['channel', 'locale', 'queue', 'skill', 'segment', 'direction'].map((key) => ({
    path: `interaction.${key}`,
    type: 'string' as const,
    label: `interaction.${key}`,
  })),
  { path: 'agent.id', type: 'string', label: 'agent.id' },
  { path: 'campaign.id', type: 'string', label: 'campaign.id' },
];
function Form({ data, close }: { data: z.infer<typeof Assignment>; close: () => void }) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    query = useQueryClient();
  const [value, setValue] = useState<Predicate>(data.expression ?? { $expr: 'true' }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [conflict, setConflict] = useState(false);
  return (
    <>
      <RuleBuilder value={value} onChange={setValue} fields={fields} />
      {error && (
        <Alert
          tone="danger"
          title={t(conflict ? 'designer.editor.conflict' : 'designer.rules.invalid')}
        />
      )}
      <Button
        loading={busy}
        disabled={conflict}
        onClick={() => {
          setBusy(true);
          setError(false);
          void request(`/v1/assignments/${data.id}`, Assignment, {
            method: 'PATCH',
            ifMatch: `"${data.version}"`,
            csrf: session.csrfToken,
            body: { expression: value },
          })
            .then(() => {
              void query.invalidateQueries({ queryKey: ['workspace'] });
              close();
            })
            .catch((error: unknown) => {
              setError(true);
              setConflict(
                error instanceof ApiError && (error.status === 409 || error.status === 412),
              );
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {t('designer.editor.apply')}
      </Button>
    </>
  );
}
export function AssignmentRule({ id, ab }: { id: string; ab: boolean }) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace(),
    ability = useAbility();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      environment,
      'assignment-rule',
      id,
    ],
    queryFn: ({ signal }) => request(`/v1/assignments/${id}`, Assignment, { signal }),
    enabled: open,
  });
  if (!ability.can('update', 'Campaign')) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t(ab ? 'designer.rules.abTargeting' : 'designer.rules.assignment')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t(ab ? 'designer.rules.abTargeting' : 'designer.rules.assignment')}
        description={t('designer.rules.assignmentDescription')}
      >
        {query.data ? (
          <Form
            key={`${query.data.id}-${query.data.version}`}
            data={query.data}
            close={() => {
              setOpen(false);
            }}
          />
        ) : query.isError ? (
          <Alert tone="danger" title={t('designer.rules.invalid')} />
        ) : (
          <p>{t('designer.editor.loading')}</p>
        )}
      </Dialog>
    </>
  );
}
