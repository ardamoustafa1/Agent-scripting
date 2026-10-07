import { z } from 'zod';

export const AiTaskSchema = z.enum([
  'draft',
  'improve',
  'scenarios',
  'translate',
  'reply',
  'objection',
  'summary',
  'navigate',
]);
export const AiConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  agentEnabled: z.boolean().default(false),
  endpointId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80)
    .default('unconfigured'),
  model: z
    .string()
    .regex(/^[a-zA-Z0-9._:/-]+$/)
    .max(120)
    .default('unconfigured'),
  secretRef: z.uuid().nullable().default(null),
  monthlyTokens: z.number().int().min(0).max(100_000_000).default(0),
  monthlyMicroUsd: z.number().int().min(0).max(1_000_000_000).default(0),
  inputMicroUsdPerMillion: z.number().int().min(0).max(100_000_000).default(0),
  outputMicroUsdPerMillion: z.number().int().min(0).max(100_000_000).default(0),
  maxOutputTokens: z.number().int().min(128).max(8192).default(2048),
});
export const AiConfigSaveSchema = z.strictObject({
  version: z.number().int().min(1),
  config: AiConfigSchema,
});
export const AiSettingsSchema = z.strictObject({
  version: z.number().int(),
  config: AiConfigSchema,
  endpoints: z.array(
    z.strictObject({
      id: z.string(),
      provider: z.enum(['anthropic', 'azure', 'onprem']),
      residency: z.string(),
      models: z.array(z.string()),
    }),
  ),
  available: z.boolean(),
});
export const AiRequestSchema = z.strictObject({
  requestId: z.uuid(),
  task: AiTaskSchema,
  locale: z.enum(['tr', 'en']).default('tr'),
  text: z.string().max(64000).default(''),
  document: z.unknown().optional(),
  scriptId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  tone: z.enum(['neutral', 'warm', 'formal', 'simple']).default('neutral'),
  file: z
    .strictObject({ kind: z.enum(['docx', 'pdf']), base64: z.string().max(2_000_000) })
    .optional(),
});
export const AiSuggestionSchema = z.strictObject({
  callId: z.uuid(),
  task: AiTaskSchema,
  requiresHumanApproval: z.literal(true),
  value: z.unknown(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  maskedCount: z.number().int(),
});
export const AiUsageSchema = z.strictObject({
  month: z.string(),
  tokens: z.number(),
  microUsd: z.number(),
  calls: z.number(),
  pending: z.number(),
  quotaTokens: z.number(),
  quotaMicroUsd: z.number(),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;
export type AiRequest = z.infer<typeof AiRequestSchema>;

export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;
