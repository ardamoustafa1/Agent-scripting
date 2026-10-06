import { z } from 'zod';

import {
  ConditionSchema,
  I18nKeySchema,
  JsonValueSchema,
  NodeIdSchema,
} from '@verbis/script-schema';

export const OptionSchema = z.strictObject({
  value: z.string().min(1).max(128),
  labelKey: I18nKeySchema,
  disabled: z.boolean().default(false),
  page: NodeIdSchema.optional(),
  responseKey: I18nKeySchema.optional(),
});
const common = {
  labelKey: I18nKeySchema.default('components.field'),
  titleKey: I18nKeySchema.optional(),
  descriptionKey: I18nKeySchema.optional(),
  hintKey: I18nKeySchema.optional(),
  placeholderKey: I18nKeySchema.optional(),
  required: z.boolean().default(false),
  disabled: z.boolean().default(false),
  validation: z
    .array(z.strictObject({ when: ConditionSchema, messageKey: I18nKeySchema }))
    .max(32)
    .default([]),
  itemPath: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/)
    .optional(),
};
export const InputSchema = z.strictObject({
  ...common,
  checked: z.boolean().optional(),
  value: z
    .union([
      z.string().max(16384),
      z.number(),
      z.boolean(),
      z.array(JsonValueSchema).max(1000),
      z.record(z.string(), JsonValueSchema),
      z.null(),
    ])
    .default(''),
  options: z.array(OptionSchema).max(1000).default([]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().default(1),
  maxLength: z.number().int().min(1).max(16384).default(512),
  currency: z.enum(['TRY', 'USD', 'EUR', 'GBP']).default('TRY'),
  mask: z
    .string()
    .regex(/^[#() +.\-/]{1,64}$/)
    .optional(),
  secure: z.boolean().default(false),
  country: z.enum(['TR', 'international']).default('TR'),
});
export const SecureInputSchema = InputSchema.omit({
  value: true,
  secure: true,
  itemPath: true,
}).extend({
  secure: z.literal(true).default(true),
  value: z.literal('').default(''),
});
export const RichBlockSchema = z.strictObject({
  tag: z.enum(['p', 'strong', 'em', 'mark', 'h3', 'li']),
  textKey: I18nKeySchema,
});
export const TextSchema = z.strictObject({
  ...common,
  textKey: I18nKeySchema.default('components.sample.script'),
  params: z.record(z.string(), JsonValueSchema).default({}),
  blocks: z.array(RichBlockSchema).max(100).default([]),
  emphasis: z.enum(['normal', 'strong', 'muted']).default('normal'),
  mustRead: z.boolean().default(false),
  acknowledged: z.boolean().default(false),
  value: z.array(z.string()).max(1000).default([]),
  options: z.array(OptionSchema).max(100).default([]),
  tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).default('info'),
  url: z.string().max(2048).optional(),
});
export const LayoutSchema = z.strictObject({
  ...common,
  columns: z.number().int().min(1).max(12).default(2),
  gap: z.enum(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']).default('md'),
  items: z.array(OptionSchema).max(100).default([]),
  value: z.union([z.string(), z.number(), z.array(JsonValueSchema)]).default(''),
  open: z.boolean().default(false),
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
  arrayVariable: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('items'),
  itemKey: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('id'),
  limit: z.number().int().min(1).max(500).default(100),
});
export const DataSchema = z.strictObject({
  ...common,
  ds: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('lookup'),
  output: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('rows'),
  trigger: z.enum(['manual', 'onLoad', 'onEvent', 'onChange']).default('manual'),
  debounceMs: z.number().int().min(0).max(30000).default(300),
  queryVariable: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('query'),
  value: z.string().default(''),
  rows: z.array(z.record(z.string(), JsonValueSchema)).max(5000).optional(),
  columns: z
    .array(
      z.strictObject({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/),
        labelKey: I18nKeySchema,
        format: z.enum(['text', 'number', 'date', 'currency']).default('text'),
      }),
    )
    .max(50)
    .default([]),
  rowKey: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('id'),
  labelField: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('name'),
  valueField: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .default('id'),
  chartType: z.enum(['bar', 'line']).default('bar'),
});
export const ActionPropsSchema = z.strictObject({
  ...common,
  variant: z.enum(['primary', 'secondary', 'ghost', 'danger']).default('primary'),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  loading: z.boolean().default(false),
  confirm: z.strictObject({ titleKey: I18nKeySchema, descriptionKey: I18nKeySchema }).optional(),
  iconKey: z.enum(['next', 'check', 'search', 'submit', 'link']).optional(),
  outcome: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
    .default('DONE'),
  code: z.string().max(64).default('DONE'),
  target: z.string().min(1).max(128).default('support'),
  value: z.string().default(''),
  options: z.array(OptionSchema).max(1000).default([]),
  scheduledAt: z.string().default(''),
  timeZone: z.string().max(64).default('Europe/Istanbul'),
});
export const MediaSchema = z.strictObject({
  ...common,
  url: z.string().max(2048).default(''),
  poster: z.string().max(2048).optional(),
  altKey: I18nKeySchema.default('components.media'),
  captionsUrl: z.string().max(2048).optional(),
  durationSec: z.number().int().min(1).max(86400).default(60),
  timer: NodeIdSchema.optional(),
  value: z
    .union([
      z.string().max(4096),
      z.number(),
      z.array(
        z.strictObject({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          stroke: z.number().int().min(0),
        }),
      ),
    ])
    .default(''),
  tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).default('info'),
  max: z.number().positive().default(100),
  feature: z.literal('signature').default('signature'),
});
export type InputProps = z.infer<typeof InputSchema>;
