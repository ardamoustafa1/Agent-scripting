import { AiAssistant } from '../components/ai-assistant.js';

import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'AI/Review assistant',
  component: AiAssistant,
  args: {
    mode: 'designer',
    generate: (input) =>
      Promise.resolve({
        callId: '00000000-0000-7000-8000-000000000001',
        task: input.task,
        requiresHumanApproval: true,
        value: { text: 'Synthetic suggestion', legalChecklist: [] },
        inputTokens: 10,
        outputTokens: 5,
        maskedCount: 1,
      }),
  },
} satisfies Meta<typeof AiAssistant>;
export default meta;
export const Designer: StoryObj<typeof meta> = {};
export const Agent: StoryObj<typeof meta> = { args: { mode: 'agent' } };
