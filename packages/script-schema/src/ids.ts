import { z } from 'zod';

/** Stable, human-readable node ids in the script model: kebab-case, never positional. */
export const NodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'Node ids must be kebab-case (e.g. "btn-submit")');

export type NodeId = z.infer<typeof NodeIdSchema>;

/**
 * Identifier addressable from expressions (`vars.<key>`, `ds.<id>.<field>`): camelCase,
 * so it never collides with the `-` operator.
 */
export const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'Identifiers must be camelCase (e.g. "customerName")');

export type Identifier = z.infer<typeof IdentifierSchema>;

/** Script id (UUIDv7, CLAUDE.md §4). */
export const ScriptIdSchema = z.uuid({ version: 'v7' });
