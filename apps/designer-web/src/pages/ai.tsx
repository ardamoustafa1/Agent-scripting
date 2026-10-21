import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useCan } from '@verbis/authz/react';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { AiSuggestionSchema } from '@verbis/shared-types';
import { AiAssistant, Alert, Button, EmptyState } from '@verbis/ui';

import { request, ResourceSchema } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';
import { CreateCampaignPicker, useCreateCampaigns } from '../workspace/create-campaign.js';

export default function AiStudio() {
  const { session } = useWorkspace(),
    { t } = useTranslation(),
    navigate = useNavigate();
  const canCreate = useCan('create', 'Script');
  const [campaignId, setCampaignId] = useState('');
  const submission = useRef<{
    payload: string;
    createKey: string;
    versionKey: string;
    scriptId?: string;
  } | null>(null);
  const status = useQuery({
    queryKey: ['ai-status', session.user.tenantId, session.user.id],
    queryFn: ({ signal }) =>
      request('/v1/ai/status', z.object({ enabled: z.boolean() }), { signal }),
    retry: false,
  });
  const campaigns = useCreateCampaigns(status.data?.enabled === true && canCreate);
  const selectedCampaign = campaigns.data?.some((c) => c.id === campaignId) === true;
  if (!status.data?.enabled)
    return (
      <section>
        <h1>{t('ai.title')}</h1>
        {status.data ? (
          // Off is a state with a way forward: who turns it on, and what it then does.
          <EmptyState
            headingLevel={2}
            icon={<Sparkles size={24} />}
            title={t('designer.ai.offTitle')}
            description={t('designer.ai.offDescription')}
            action={
              <>
                <ul className="dw-ai-off-list">
                  {(['draft', 'improve', 'scenarios', 'translate'] as const).map((task) => (
                    <li key={task}>{t(`ai.${task}`)}</li>
                  ))}
                </ul>
                <p>{t('designer.ai.offSafety')}</p>
              </>
            }
          />
        ) : (
          <Alert title={t(status.isError ? 'ai.error' : 'ai.loading')} />
        )}
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
        draftTarget={{
          control: canCreate ? (
            <CreateCampaignPicker
              campaigns={campaigns}
              value={campaignId}
              onChange={setCampaignId}
            />
          ) : (
            <Alert tone="warning" title={t('designer.workspace.createForbidden')} />
          ),
          ready: canCreate && selectedCampaign,
        }}
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
          if (!canCreate || !selectedCampaign) throw new Error('VERBIS_AUTHZ_SCOPE_MISSING');
          const document = ScriptDocumentSchema.parse(value);
          const payload = JSON.stringify({ document, campaignId });
          if (submission.current?.payload !== payload)
            submission.current = {
              payload,
              createKey: crypto.randomUUID(),
              versionKey: crypto.randomUUID(),
            };
          const draft = submission.current;
          if (!draft.scriptId) {
            const script = await request('/v1/scripts', ResourceSchema, {
              method: 'POST',
              csrf: session.csrfToken,
              body: { name: document.meta.name, tags: document.meta.tags, campaignId },
              idempotencyKey: draft.createKey,
            });
            draft.scriptId = script.id;
          }
          await request(`/v1/scripts/${draft.scriptId}/versions`, z.unknown(), {
            method: 'POST',
            csrf: session.csrfToken,
            body: { document },
            idempotencyKey: draft.versionKey,
          });
          void navigate(`/scripts/${draft.scriptId}`);
        }}
      />
    </section>
  );
}
