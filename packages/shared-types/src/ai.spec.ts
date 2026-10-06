import { expect, it } from 'vitest';

import { AiConfigSchema, AiRequestSchema, AiSuggestionSchema } from './ai.js';
import {
  PreviewLiveCallSchema,
  PreviewLiveResultSchema,
  RegressionReportSchema,
} from './preview.js';

const id = '01928f3a-0000-7000-8000-0000000000ff';
it('AI defaults deny execution until explicitly configured and bound token budgets', () => {
  expect(AiConfigSchema.parse({})).toMatchObject({
    enabled: false,
    agentEnabled: false,
    secretRef: null,
    monthlyTokens: 0,
    maxOutputTokens: 2048,
  });
  for (const bad of [
    { maxOutputTokens: 127 },
    { maxOutputTokens: 8193 },
    { monthlyTokens: -1 },
    { endpointId: 'https://evil.test' },
    { secretRef: 'secret' },
  ])
    expect(AiConfigSchema.safeParse(bad).success).toBe(false);
});
it('requires explicit human approval for suggestions and bounds uploaded content', () => {
  const suggestion = {
    callId: id,
    task: 'draft',
    requiresHumanApproval: true,
    value: { text: 'synthetic' },
    inputTokens: 1,
    outputTokens: 2,
    maskedCount: 0,
  };
  expect(AiSuggestionSchema.parse(suggestion)).toEqual(suggestion);
  expect(
    AiSuggestionSchema.safeParse({ ...suggestion, requiresHumanApproval: false }).success,
  ).toBe(false);
  expect(AiRequestSchema.parse({ requestId: id, task: 'reply' })).toMatchObject({
    locale: 'tr',
    tone: 'neutral',
    text: '',
  });
  expect(
    AiRequestSchema.safeParse({ requestId: id, task: 'reply', text: 'x'.repeat(64001) }).success,
  ).toBe(false);
});
it('live preview calls cannot select production and responses expose only value and timing', () => {
  expect(PreviewLiveCallSchema.parse({ input: { amount: 10 }, environment: 'test' })).toEqual({
    input: { amount: 10 },
    environment: 'test',
  });
  expect(PreviewLiveCallSchema.safeParse({ input: {}, environment: 'production' }).success).toBe(
    false,
  );
  expect(PreviewLiveResultSchema.safeParse({ value: null, durationMs: -1 }).success).toBe(false);
  expect(
    PreviewLiveResultSchema.safeParse({ value: null, durationMs: 0, credentials: 'private' })
      .success,
  ).toBe(false);
  expect(
    RegressionReportSchema.parse({
      checksum: 'hash',
      version: 1,
      passed: false,
      checkedAt: '2026-10-03T12:00:00Z',
      results: [
        {
          id: 'case',
          passed: false,
          durationMs: 0,
          assertions: [{ path: '/page', passed: false }],
          code: 'FAILED',
        },
      ],
    }).results[0]?.passed,
  ).toBe(false);
});
