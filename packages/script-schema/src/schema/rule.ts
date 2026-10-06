import { z } from 'zod';

import { NodeIdSchema } from '../ids.js';

import { ActionSchema } from './actions.js';
import {
  ExpressionRefSchema,
  JsonValueSchema,
  type ExpressionRef,
  type JsonValue,
} from './primitives.js';

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'matches',
  'exists',
  'between',
  'before',
  'after',
] as const;
export const RuleOperatorSchema = z.enum(RULE_OPERATORS);
export type RuleOperator = z.infer<typeof RuleOperatorSchema>;

/** Fact path read by a rule leaf, e.g. `vars.segment`, `ds.customerLookup.balance`. */
export const FactPathSchema = z
  .string()
  .max(256)
  .regex(
    /^(vars|ds|interaction|agent|campaign|const)(\.[A-Za-z0-9_]+)+$/,
    'Expected a fact path like "vars.segment"',
  );

export interface PredicateLeaf {
  fact: string;
  op: RuleOperator;
  value?: JsonValue | undefined;
}
export type Predicate =
  { all: Predicate[] } | { any: Predicate[] } | { not: Predicate } | PredicateLeaf | ExpressionRef;

export const PredicateLeafSchema = z.strictObject({
  fact: FactPathSchema,
  op: RuleOperatorSchema,
  value: JsonValueSchema.optional(),
});

/** JSON predicate tree (SCRIPT_MODEL §6); the same format the rule builder edits. */
export const PredicateSchema: z.ZodType<Predicate> = z
  .lazy(() =>
    z.union([
      z.strictObject({ all: z.array(PredicateSchema).min(1) }),
      z.strictObject({ any: z.array(PredicateSchema).min(1) }),
      z.strictObject({ not: PredicateSchema }),
      PredicateLeafSchema,
      ExpressionRefSchema,
    ]),
  )
  .meta({ id: 'Predicate' });

export const RuleSchema = z
  .strictObject({
    id: NodeIdSchema,
    description: z.string().max(500).optional(),
    when: PredicateSchema,
    then: z.array(ActionSchema).default([]),
    else: z.array(ActionSchema).optional(),
  })
  .meta({ id: 'Rule' });
export type Rule = z.infer<typeof RuleSchema>;
