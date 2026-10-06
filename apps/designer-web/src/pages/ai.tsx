import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { AiSuggestionSchema } from '@verbis/shared-types';
import { AiAssistant, Alert, Button } from '@verbis/ui';

import { request, ResourceSchema } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

export default function AiStudio() {
  const { session } = useWorkspace(),
    { t } = useTranslation(),
    navigate = useNavigate();
  const status = useQuery({
    queryKey: ['ai-status', session.user.tenantId, session.user.id],
    queryFn: ({ signal }) =>
      request('/v1/ai/status', z.object({ enabled: z.boolean() }), { signal }),
    retry: false,
  });
  if (!status.data?.enabled)
    return (
      <section>
        <h1>{t('ai.title')}</h1>
        <Alert
          title={t(status.isError ? 'ai.error' : status.isPending ? 'ai.loading' : 'ai.disabled')}
        />
        {status.isError && (
          <Button onClick={() => void status.refetch()}>{t('common.retry')}</Button>
        )}
      </section>
    );
  return (
    <section>
      <h1>{t('ai.title')}</h1>
      <AiAssistant
        mode="designer"
        generate={(input) =>
          request('/v1/ai/suggestions', AiSuggestionSchema, {
            method: 'POST',
            csrf: session.csrfToken,
            body: input,
          })
        }
        onAccept={async (value, task) => {
          if (task !== 'draft') {
            const proposal = z.looseObject({ text: z.string().optional() }).safeParse(value);
            await navigator.clipboard.writeText(
              proposal.success && proposal.data.text
                ? proposal.data.text
                : JSON.stringify(value, null, 2),
            );
            return;
          }
          const document = ScriptDocumentSchema.parse(value);
          const script = await request('/v1/scripts', ResourceSchema, {
            method: 'POST',
            csrf: session.csrfToken,
            body: { name: document.meta.name, tags: document.meta.tags },
          });
          await request(`/v1/scripts/${script.id}/versions`, z.unknown(), {
            method: 'POST',
            csrf: session.csrfToken,
            body: { document },
          });
          void navigate(`/scripts/${script.id}`);
        }}
      />
    </section>
  );
}
