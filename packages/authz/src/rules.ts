import { z } from 'zod';

import { ActionSchema, SubjectTypeSchema, type Action, type SubjectType } from './vocabulary.js';

/**
 * A rule as stored/defined: CASL raw rule whose condition values may be placeholders, resolved per
 * principal and role assignment. Placeholders are whole-string tokens only (no expression syntax):
 * `${user.id}`, `${scope.campaignIds}`, `${scope.teamIds}`, `${scope.siteIds}`.
 */
export const PLACEHOLDERS = [
  '${user.id}',
  '${scope.campaignIds}',
  '${scope.teamIds}',
  '${scope.siteIds}',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

type ConditionValue = string | number | boolean | null | ConditionValue[] | ConditionObject;
interface ConditionObject {
  [key: string]: ConditionValue;
}

const ConditionValueSchema: z.ZodType<ConditionValue> = z.lazy(() =>
  z.union([
    z.string().max(256),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ConditionValueSchema).max(256),
    z.record(z.string().max(64), ConditionValueSchema),
  ]),
);

/** Mongo-style operators CASL accepts here; anything else is rejected at the edge. */
const ALLOWED_OPERATORS = new Set(['$eq', '$ne', '$in', '$nin', '$all', '$exists', '$elemMatch']);

function operatorsAllowed(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(operatorsAllowed);
  if (value === null || typeof value !== 'object') return true;
  return Object.entries(value).every(
    ([key, inner]) =>
      (!key.startsWith('$') || ALLOWED_OPERATORS.has(key)) && operatorsAllowed(inner),
  );
}

export const RuleDefinitionSchema = z
  .object({
    action: z.union([ActionSchema, z.array(ActionSchema).min(1)]),
    subject: z.union([SubjectTypeSchema, z.array(SubjectTypeSchema).min(1)]),
    fields: z.array(z.string().min(1).max(128)).max(64).optional(),
    conditions: z.record(z.string().max(64), ConditionValueSchema).optional(),
    inverted: z.boolean().optional(),
    /** i18n key explaining a denial (inverted rules). */
    reason: z.string().max(128).optional(),
  })
  .strict()
  .refine((rule) => operatorsAllowed(rule.conditions), {
    message: 'Unsupported condition operator',
    path: ['conditions'],
  });

export interface RuleDefinition {
  action: Action | Action[];
  subject: SubjectType | SubjectType[];
  fields?: string[];
  conditions?: Record<string, ConditionValue>;
  inverted?: boolean;
  reason?: string;
}

/** Attribute scope of a role assignment (ABAC). `'*'` means unrestricted. */
export const ScopeSchema = z
  .object({
    campaignIds: z.union([z.literal('*'), z.array(z.string().min(1).max(64)).max(1000)]).optional(),
    teamIds: z.union([z.literal('*'), z.array(z.string().min(1).max(64)).max(1000)]).optional(),
    siteIds: z.union([z.literal('*'), z.array(z.string().min(1).max(64)).max(1000)]).optional(),
  })
  .strict();
export type Scope = z.infer<typeof ScopeSchema>;

export interface RuleContext {
  readonly userId: string;
  readonly scope: Scope;
}

const ANY = Symbol('any');
type Resolved = ConditionValue | typeof ANY | undefined;

function resolvePlaceholder(token: Placeholder, context: RuleContext): Resolved {
  switch (token) {
    case '${user.id}':
      return context.userId;
    case '${scope.campaignIds}':
      return scopeValue(context.scope.campaignIds);
    case '${scope.teamIds}':
      return scopeValue(context.scope.teamIds);
    case '${scope.siteIds}':
      return scopeValue(context.scope.siteIds);
  }
}

/** Missing scope ⇒ empty set (deny); `'*'` ⇒ the condition is dropped (allow all). */
function scopeValue(value: '*' | string[] | undefined): Resolved {
  if (value === '*') return ANY;
  return [...(value ?? [])];
}

function isPlaceholder(value: unknown): value is Placeholder {
  return typeof value === 'string' && (PLACEHOLDERS as readonly string[]).includes(value);
}

function resolveValue(value: ConditionValue, context: RuleContext): Resolved {
  if (isPlaceholder(value)) return resolvePlaceholder(value, context);
  if (Array.isArray(value)) {
    const out: ConditionValue[] = [];
    for (const item of value) {
      const resolved = resolveValue(item, context);
      if (resolved === ANY) return ANY;
      if (resolved !== undefined) out.push(resolved);
    }
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out: ConditionObject = {};
    for (const [key, inner] of Object.entries(value)) {
      const resolved = resolveValue(inner, context);
      if (resolved === ANY) return ANY;
      if (resolved !== undefined) out[key] = resolved;
    }
    return out;
  }
  return value;
}

export interface ResolvedRule {
  action: Action | Action[];
  subject: SubjectType | SubjectType[];
  fields?: string[];
  conditions?: Record<string, ConditionValue>;
  inverted?: boolean;
  reason?: string;
}

/**
 * Substitutes placeholders. A field condition that resolves to "any" (`'*'` scope) is removed,
 * which widens an allow rule; for an inverted rule it would widen the denial, so it is kept narrow
 * by dropping the whole inverted rule instead.
 */
export function resolveRule(rule: RuleDefinition, context: RuleContext): ResolvedRule | undefined {
  const { conditions, ...rest } = rule;
  if (conditions === undefined) return { ...rest };
  const out: Record<string, ConditionValue> = {};
  for (const [field, value] of Object.entries(conditions)) {
    const resolved = resolveValue(value, context);
    if (resolved === ANY) {
      if (rule.inverted === true) return undefined;
      continue;
    }
    if (resolved !== undefined) out[field] = resolved;
  }
  return Object.keys(out).length === 0 ? { ...rest } : { ...rest, conditions: out };
}
