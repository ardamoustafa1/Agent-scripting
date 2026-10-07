import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { SuggestionSchema, type Suggestion } from '@verbis/shared-types';
import { Alert, Badge, Button, Textarea } from '@verbis/ui';

import { ApiError, request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const TONE = { open: 'info', accepted: 'success', rejected: 'neutral', stale: 'warning' } as const;

/** Owner view of the suggestions on a draft (ADR-0051): read, accept or reject. */
export function Suggestions({
  scriptId,
  number,
  onAccepted,
}: {
  scriptId: string;
  number: number;
  /** The draft changed on the server; the editor must reload it. */
  onAccepted?: () => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(''),
    [problem, setProblem] = useState('');
  const path = `/v1/scripts/${scriptId}/versions/${number}/suggestions`,
    key = [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'suggestions',
      scriptId,
      number,
    ];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(path, z.array(SuggestionSchema), { signal }),
    refetchInterval: 15000,
  });
  const decide = async (suggestion: Suggestion, action: 'accept' | 'reject') => {
    setBusy(suggestion.id);
    setProblem('');
    try {
      await request(`${path}/${suggestion.id}/${action}`, SuggestionSchema, {
        method: 'POST',
        csrf: session.csrfToken,
        body:
          action === 'reject' && reason[suggestion.id]?.trim()
            ? { reason: reason[suggestion.id]?.trim() }
            : {},
      });
      await client.invalidateQueries({ queryKey: key });
      if (action === 'accept') onAccepted?.();
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 409 ? 'conflict' : 'failed');
      await client.invalidateQueries({ queryKey: key });
    } finally {
      setBusy('');
    }
  };
  const canDecide = ability.can('update', 'Script');
  return (
    <section className="lc-card" aria-label={t('designer.suggest.panelTitle')}>
      <h2>{t('designer.suggest.panelTitle')}</h2>
      {(problem || query.isError) && (
        <Alert tone="danger" title={t(`designer.suggest.decideProblem.${problem || 'failed'}`)} />
      )}
      {query.data?.length === 0 && <p>{t('designer.suggest.empty')}</p>}
      <ul className="lc-threads">
        {query.data?.map((suggestion) => (
          <li key={suggestion.id}>
            <Badge tone={TONE[suggestion.state]}>
              {t(`designer.suggest.state.${suggestion.state}`)}
            </Badge>{' '}
            <strong>{suggestion.title}</strong>
            {suggestion.note && <p>{suggestion.note}</p>}
            <ul aria-label={t('designer.suggest.operations')}>
              {suggestion.operations.map((operation, index) => (
                <li key={`${operation.op}${operation.path}${String(index)}`}>
                  <code>
                    {t(`designer.suggest.op.${operation.op}`)} {operation.path}
                  </code>
                </li>
              ))}
            </ul>
            <time>{suggestion.createdAt}</time>
            {suggestion.state === 'stale' && <p>{t('designer.suggest.staleHint')}</p>}
            {suggestion.decisionReason && <p>{suggestion.decisionReason}</p>}
            {canDecide && (suggestion.state === 'open' || suggestion.state === 'stale') && (
              <>
                {suggestion.state === 'open' && (
                  <Button
                    size="sm"
                    loading={busy === suggestion.id}
                    onClick={() => void decide(suggestion, 'accept')}
                  >
                    {t('designer.suggest.accept')}
                  </Button>
                )}
                <Textarea
                  label={t('designer.suggest.rejectReason')}
                  value={reason[suggestion.id] ?? ''}
                  maxLength={500}
                  onChange={(event) => {
                    setReason({ ...reason, [suggestion.id]: event.target.value });
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === suggestion.id}
                  onClick={() => void decide(suggestion, 'reject')}
                >
                  {t('designer.suggest.reject')}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
