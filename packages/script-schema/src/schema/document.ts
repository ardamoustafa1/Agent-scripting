import { z } from 'zod';

import { ScriptIdSchema } from '../ids.js';
import { SCRIPT_SCHEMA_VERSION, SemverSchema } from '../version.js';

import { DataSourceRefSchema } from './data-source.js';
import { FlowSchema } from './flow.js';
import { ComponentTypeSchema } from './node.js';
import { PageSchema } from './page.js';
import { TestScenarioSchema } from './preview.js';
import { LocaleSchema, I18nKeySchema, ToneTokenSchema } from './primitives.js';
import { RuleSchema } from './rule.js';
import { VariableSchema } from './variable.js';

export const ChannelTypeSchema = z.enum([
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'social',
  'video',
  'callback',
]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ScriptMetaSchema = z.strictObject({
  /** Authoring name (tenant content). */
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  channels: z.array(ChannelTypeSchema).default([]),
  /** Platform capabilities the script needs, e.g. `transfer`, `hold` (validated against the channel at runtime). */
  capabilities: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/)).default([]),
});

export const ThemeOverrideSchema = z.strictObject({
  mode: z.enum(['inherit', 'light', 'dark']).default('inherit'),
  tokens: z
    .strictObject({
      density: z.enum(['compact', 'comfortable']).optional(),
      radius: z.enum(['none', 'sm', 'md', 'lg']).optional(),
      accent: ToneTokenSchema.optional(),
    })
    .default({}),
});

export const I18nSchema = z
  .strictObject({
    defaultLocale: LocaleSchema,
    /** `messages[locale][key]` — flat dictionaries, ICU MessageFormat values. */
    messages: z.record(LocaleSchema, z.record(I18nKeySchema, z.string().max(4_000))),
  })
  .meta({ id: 'ScriptI18n' });
export type ScriptI18n = z.infer<typeof I18nSchema>;

export const ComponentRegistryEntrySchema = z.strictObject({
  type: ComponentTypeSchema,
  version: SemverSchema,
  integrity: z.string().regex(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/, 'Expected an SRI hash'),
});

export const ScriptDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(SCRIPT_SCHEMA_VERSION),
    id: ScriptIdSchema,
    meta: ScriptMetaSchema,
    variables: z.array(VariableSchema).default([]),
    dataSources: z.array(DataSourceRefSchema).default([]),
    pages: z.array(PageSchema).min(1),
    flow: FlowSchema,
    subflows: z.array(FlowSchema).default([]),
    rules: z.array(RuleSchema).default([]),
    theme: ThemeOverrideSchema.optional(),
    i18n: I18nSchema,
    componentRegistry: z.array(ComponentRegistryEntrySchema).default([]),
    testScenarios: z.array(TestScenarioSchema).max(20).optional(),
  })
  .meta({
    id: 'ScriptDocument',
    title: 'Verbis script document',
    description: 'Pure-data script version document (docs/SCRIPT_MODEL.md, ADR-0006, ADR-0010).',
  });

/** Parsed (defaults applied) document. */
export type ScriptDocument = z.infer<typeof ScriptDocumentSchema>;
/** Authoring shape (defaults optional). Fixtures and editors produce this. */
export type ScriptDocumentInput = z.input<typeof ScriptDocumentSchema>;
