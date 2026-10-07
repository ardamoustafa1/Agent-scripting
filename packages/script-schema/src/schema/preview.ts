import { z } from 'zod';

import { IdentifierSchema, NodeIdSchema } from '../ids.js';

import { ActionSchema } from './actions.js';
import { EventKeySchema } from './node.js';
import { JsonValueSchema } from './primitives.js';

export const PreviewContextSchema = z.strictObject({
  variables: z.record(IdentifierSchema, JsonValueSchema).default({}),
  interaction: z.record(z.string(), JsonValueSchema).default({}),
  agent: z.record(z.string(), JsonValueSchema).default({}),
  campaign: z.record(z.string(), JsonValueSchema).default({}),
  const: z.record(z.string(), JsonValueSchema).default({}),
  locale: z.enum(['tr', 'en']).default('tr'),
});
export const PreviewStepSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('variable'),
    variable: IdentifierSchema,
    value: JsonValueSchema,
  }),
  z.strictObject({ type: z.literal('event'), node: NodeIdSchema, event: EventKeySchema }),
  z.strictObject({ type: z.literal('read'), node: NodeIdSchema, acknowledged: z.boolean() }),
  z.strictObject({
    type: z.literal('actions'),
    actions: z.array(ActionSchema).max(100),
    ignoreError: z.boolean().optional(),
  }),
]);
export type PreviewStep = z.infer<typeof PreviewStepSchema>;
export const PreviewMockSchema = z.strictObject({
  kind: z.enum(['success', 'empty', 'error', 'delay']).default('success'),
  outputs: z.record(z.string(), JsonValueSchema).default({}),
  delayMs: z.number().int().min(0).max(2000).default(0),
});
/** Synthetic fixtures only: live responses and sensitive variable recordings must not be persisted. */
export const TestScenarioSchema = z
  .strictObject({
    id: IdentifierSchema,
    name: z.string().trim().min(1).max(120),
    synthetic: z.literal(true),
    context: PreviewContextSchema,
    dataSources: z.record(IdentifierSchema, PreviewMockSchema).default({}),
    steps: z.array(PreviewStepSchema).max(500),
    expected: z.strictObject({
      outcome: z.string().max(128).optional(),
      page: NodeIdSchema.optional(),
      ended: z.boolean().optional(),
      variables: z.record(IdentifierSchema, JsonValueSchema).default({}),
    }),
  })
  .refine(
    (value) =>
      value.expected.outcome !== undefined ||
      value.expected.page !== undefined ||
      value.expected.ended !== undefined ||
      Object.keys(value.expected.variables).length > 0,
    'At least one assertion is required',
  );
export type TestScenario = z.infer<typeof TestScenarioSchema>;
export type TestScenarioInput = z.input<typeof TestScenarioSchema>;
