import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import { AiSuggestionSchema } from '@verbis/shared-types';
import { AiAssistant } from '@verbis/ui';

import { api } from './api.js';

import type { AgentController } from './controller.js';

export function AgentAiPanel({ controller, csrf }: { controller: AgentController; csrf: string }) {
  const c = controller;
  const state = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  const status = useQuery({
    queryKey: ['agent-ai-status', c.id],
    queryFn: ({ signal }) =>
      api('/v1/ai/status', z.object({ agentEnabled: z.boolean() }), undefined, undefined, signal),
    retry: false,
  });
  if (
    !status.data?.agentEnabled ||
    (!['chat', 'email'].includes(c.desktop.interaction.channel) &&
      !['wrapup', 'completed', 'abandoned'].includes(state.view.state))
  )
    return null;
  return (
    <AiAssistant
      key={`${c.id}-${state.view.state}`}
      mode="agent"
      allowedTasks={
        ['chat', 'email'].includes(c.desktop.interaction.channel)
          ? state.view.state === 'wrapup' || state.view.state === 'completed'
            ? ['summary']
            : ['reply', 'objection']
          : ['summary']
      }
      review={!state.readOnly && state.online}
      generate={(input) =>
        api('/v1/ai/suggestions', AiSuggestionSchema, csrf, { ...input, sessionId: c.id })
      }
      onAccept={async (value, task) => {
        const result = z
          .looseObject({
            reply: z.string().optional(),
            summary: z.string().optional(),
            disposition: z.string().nullable().optional(),
            objectionNodeId: z.string().nullable().optional(),
          })
          .parse(value);
        if (task === 'reply') {
          await navigator.clipboard.writeText(result.reply ?? '');
          return;
        }
        if (task === 'objection' && result.objectionNodeId) {
          const root = document.querySelector(`[data-agent-session="${CSS.escape(c.id)}"]`);
          const node = root?.querySelector(
            `[data-runtime-node="${CSS.escape(result.objectionNodeId)}"]`,
          );
          const target = node?.firstElementChild;
          target?.scrollIntoView({ block: 'center', behavior: 'auto' });
          if (target instanceof HTMLElement) {
            target.tabIndex = -1;
            target.focus({ preventScroll: true });
          }
          return;
        }
        if (task === 'summary')
          c.preferences({
            note: result.summary ?? '',
            ...(result.disposition ? { disposition: result.disposition } : {}),
          });
      }}
    />
  );
}
