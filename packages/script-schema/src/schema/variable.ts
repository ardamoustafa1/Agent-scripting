import { z } from 'zod';

import { IdentifierSchema } from '../ids.js';

import { JsonValueSchema } from './primitives.js';

export const VariableTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'object',
  'array',
  'enum',
]);
export type VariableType = z.infer<typeof VariableTypeSchema>;

/** `global` holds read-only tenant constants; every other scope is writable. */
export const VariableScopeSchema = z.enum(['session', 'page', 'interaction', 'campaign', 'global']);
export type VariableScope = z.infer<typeof VariableScopeSchema>;

/**
 * Drives logging, audit diff, persistence and masking (DOMAIN Variable). There is no
 * `secret` class: secrets never live in script variables (CLAUDE.md rule 12).
 */
export const ClassificationSchema = z.enum(['public', 'internal', 'pii', 'pci']);
export type Classification = z.infer<typeof ClassificationSchema>;

export const VariableSchema = z
  .strictObject({
    key: IdentifierSchema,
    type: VariableTypeSchema,
    scope: VariableScopeSchema,
    default: JsonValueSchema.optional(),
    /** Allowed values when `type` is `enum`. */
    enumValues: z.array(z.string().min(1).max(64)).min(1).optional(),
    pii: z.boolean().default(false),
    classification: ClassificationSchema.default('internal'),
    /** Persist the value into SessionEvents / session snapshot (never allowed for `pci`). */
    persist: z.boolean().default(false),
    /** Pre-population from interaction data, e.g. `interaction.attributes.customerId`. */
    source: z
      .string()
      .regex(
        /^(interaction|agent|campaign)(\.[A-Za-z0-9_-]+)+$/,
        'Expected a source path like "interaction.ani"',
      )
      .optional(),
    description: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      !(v.pii || v.classification === 'pii' || v.classification === 'pci') ||
      v.default === undefined ||
      v.default === null ||
      v.default === '',
    {
      message: 'Sensitive defaults must be empty; populate through a protected runtime source',
      path: ['default'],
    },
  )
  .meta({ id: 'Variable' });

export type Variable = z.infer<typeof VariableSchema>;
export type VariableInput = z.input<typeof VariableSchema>;
