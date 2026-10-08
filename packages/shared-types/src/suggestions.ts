import { z } from 'zod';

/**
 * Suggestion mode (ADR-0051, DIFFERENTIATORS C2): a reviewer proposes a change as RFC 6902
 * operations; the owner applies it in one step. Only `add` / `replace` / `remove` exist because
 * the document tree helpers (`applyJsonPatch`) support exactly those.
 */
const PointerSchema = z
  .string()
  .max(512)
  .regex(/^(\/[^/]*)+$/, 'Expected a JSON pointer such as /pages/0/name');

export const SuggestionOperationSchema = z
  .discriminatedUnion('op', [
    z.strictObject({ op: z.literal('add'), path: PointerSchema, value: z.json() }),
    z.strictObject({ op: z.literal('replace'), path: PointerSchema, value: z.json() }),
    z.strictObject({ op: z.literal('remove'), path: PointerSchema }),
  ])
  .meta({ id: 'SuggestionOperation' });
export type SuggestionOperation = z.infer<typeof SuggestionOperationSchema>;

export const SuggestionInputSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120),
    note: z.string().trim().max(1000).optional(),
    operations: z.array(SuggestionOperationSchema).min(1).max(200),
  })
  .meta({ id: 'SuggestionInput' });
export type SuggestionInput = z.infer<typeof SuggestionInputSchema>;

export const SuggestionStateSchema = z.enum(['open', 'accepted', 'rejected', 'stale']);
export type SuggestionState = z.infer<typeof SuggestionStateSchema>;

export const SuggestionDecisionSchema = z
  .strictObject({ reason: z.string().trim().max(500).optional() })
  .meta({ id: 'SuggestionDecision' });

export const SuggestionSchema = z
  .strictObject({
    id: z.uuid(),
    scriptId: z.uuid(),
    versionNumber: z.number().int().positive(),
    title: z.string(),
    note: z.string().nullable(),
    operations: z.array(SuggestionOperationSchema),
    state: SuggestionStateSchema,
    createdAt: z.iso.datetime(),
    createdBy: z.string(),
    decidedAt: z.iso.datetime().nullable(),
    decidedBy: z.string().nullable(),
    decisionReason: z.string().nullable(),
  })
  .meta({ id: 'Suggestion' });
export type Suggestion = z.infer<typeof SuggestionSchema>;
