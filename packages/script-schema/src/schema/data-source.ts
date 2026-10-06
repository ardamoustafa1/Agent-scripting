import { z } from 'zod';

import { IdentifierSchema } from '../ids.js';

import { ValueSchema } from './primitives.js';

/** Restricted JSONPath into the mapped response: `$.data.items[0].name`. */
export const JsonPathSchema = z
  .string()
  .max(256)
  .regex(/^\$(\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/, 'Expected a JSONPath like "$.data.fullName"');

export const DataSourceOutputSchema = z.strictObject({
  path: JsonPathSchema,
  /** Optionally copy the field into a variable after each successful call. */
  variable: IdentifierSchema.optional(),
});

/**
 * Reference to a tenant DataSource (SCRIPT_MODEL §3). The protocol, endpoint and secrets live in
 * the integration module; the script only carries the id, version and input/output mapping.
 */
export const DataSourceRefSchema = z
  .strictObject({
    id: IdentifierSchema,
    ref: z
      .string()
      .regex(
        /^tenant-datasource:[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        'Expected "tenant-datasource:<key>"',
      ),
    version: z.int().min(1),
    inputs: z.record(IdentifierSchema, ValueSchema).default({}),
    outputs: z.record(IdentifierSchema, DataSourceOutputSchema).default({}),
    policy: z
      .strictObject({
        /** Recovery remains blocking unless the author explicitly allows operator fallback. */
        onFailure: z.enum(['block', 'continue', 'manual']).optional(),
        trigger: z.enum(['manual', 'onEnter']).default('manual'),
        timeoutMs: z.int().min(100).max(30_000).default(5_000),
        cacheTtlSec: z.int().min(0).max(3_600).default(0),
      })
      .prefault({}),
  })
  .meta({ id: 'DataSourceRef' });

export type DataSourceRef = z.infer<typeof DataSourceRefSchema>;
