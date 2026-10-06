import { z } from 'zod';

import { NodeIdSchema } from '../ids.js';

import { ActionSchema } from './actions.js';
import { NodeSchema } from './node.js';
import { I18nKeySchema } from './primitives.js';

export const TimerSchema = z
  .strictObject({
    id: NodeIdSchema,
    durationMs: z.int().min(1_000).max(86_400_000),
    repeat: z.boolean().default(false),
    autoStart: z.boolean().default(false),
    onElapsed: z.array(ActionSchema).min(1),
  })
  .meta({ id: 'Timer' });
export type Timer = z.infer<typeof TimerSchema>;

export const PageSchema = z
  .strictObject({
    id: NodeIdSchema,
    /** Authoring label shown in the designer (tenant content, not platform UI text). */
    name: z.string().trim().min(1).max(120),
    /** Runtime title shown to the agent. */
    titleKey: I18nKeySchema.optional(),
    layout: NodeSchema,
    onEnter: z.array(ActionSchema).default([]),
    onLeave: z.array(ActionSchema).default([]),
    /** The agent may not leave the session until this page has been visited and validated. */
    mandatory: z.boolean().default(false),
    timers: z.array(TimerSchema).default([]),
  })
  .meta({ id: 'Page' });

export type Page = z.infer<typeof PageSchema>;
export type PageInput = z.input<typeof PageSchema>;
