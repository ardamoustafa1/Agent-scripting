import { z } from 'zod';

import { NodeIdSchema } from '../ids.js';

import { I18nKeySchema, LocaleSchema } from './primitives.js';

/** Bounds of the `triggers` section (ADR-0052, 2026-10-22). */
export const TRIGGER_LIMITS = {
  maxTriggers: 100,
  maxPhrasesPerLocale: 20,
  maxPhraseLength: 80,
  maxActions: 3,
} as const;

/** Whose words a trigger listens to. */
export const TriggerSpeakerSchema = z.enum(['customer', 'agent', 'any']);
export type TriggerSpeaker = z.infer<typeof TriggerSpeakerSchema>;

export const TriggerToneSchema = z.enum(['info', 'success', 'warning', 'danger']);
export type TriggerTone = z.infer<typeof TriggerToneSchema>;

/**
 * What the agent is offered when a trigger fires. Nothing runs by itself: a page suggestion waits
 * for the agent's click and a notice hint never acknowledges the notice.
 */
export const TriggerActionSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('suggestPage'), pageId: NodeIdSchema }),
    z.strictObject({
      type: z.literal('alert'),
      messageKey: I18nKeySchema,
      tone: TriggerToneSchema.default('info'),
    }),
    z.strictObject({ type: z.literal('markNotice'), noticeId: NodeIdSchema }),
  ])
  .meta({ id: 'TriggerAction' });
export type TriggerAction = z.infer<typeof TriggerActionSchema>;

/** `once` per session, or again after a cooldown. */
export const TriggerRepeatSchema = z.union([
  z.literal('once'),
  z.strictObject({ cooldownSeconds: z.number().int().min(10).max(3_600) }),
]);
export type TriggerRepeat = z.infer<typeof TriggerRepeatSchema>;

export const TriggerPhraseSchema = z.string().trim().min(1).max(TRIGGER_LIMITS.maxPhraseLength);

/** A phrase rule over the live transcript (deterministic, no model call). */
export const TriggerSchema = z
  .strictObject({
    id: NodeIdSchema,
    /** Authoring name (tenant content, shown in the designer only). */
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    /** Phrases per locale; a segment is matched against its own language, else all of them. */
    phrases: z.record(
      LocaleSchema,
      z.array(TriggerPhraseSchema).max(TRIGGER_LIMITS.maxPhrasesPerLocale),
    ),
    speaker: TriggerSpeakerSchema.default('customer'),
    /** Only while one of these pages is shown; absent or empty means any page. */
    pages: z.array(NodeIdSchema).max(100).optional(),
    repeat: TriggerRepeatSchema.default('once'),
    actions: z.array(TriggerActionSchema).min(1).max(TRIGGER_LIMITS.maxActions),
  })
  .meta({ id: 'ScriptTrigger' });
export type ScriptTrigger = z.infer<typeof TriggerSchema>;
export type ScriptTriggerInput = z.input<typeof TriggerSchema>;
