import {
  createMongoAbility,
  ForbiddenError,
  subject as caslSubject,
  type MongoAbility,
  type RawRuleOf,
} from '@casl/ability';
import { packRules, unpackRules, type PackRule } from '@casl/ability/extra';

import { resolveRule, type RuleContext, type RuleDefinition, type Scope } from './rules.js';
import { separationOfDutiesRules } from './sod.js';
import { PII_FIELDS, type Action, type SubjectType } from './vocabulary.js';

type ConcreteSubject = Exclude<SubjectType, 'all'>;
export type SubjectRecord = Record<string, unknown>;
export type AppSubject = SubjectType | (SubjectRecord & { readonly __caslSubjectType__: string });
export type AppAbility = MongoAbility<[Action, AppSubject]>;
export type AppRawRule = RawRuleOf<AppAbility>;

/** Tags a record with its subject type for instance-level (ABAC) checks. Does not mutate. */
export function asSubject(type: ConcreteSubject, record: SubjectRecord): AppSubject {
  return caslSubject(type, { ...record });
}

export interface Grant {
  readonly rules: readonly RuleDefinition[];
  readonly scope: Scope;
}

export interface AbilityInput {
  readonly userId: string;
  readonly grants: readonly Grant[];
  readonly settings?: { readonly separationOfDuties?: boolean };
}

/**
 * Resolves every grant with its own scope (a Designer for campaign A and an Approver for B never
 * combine into "approve A"), then appends inverted SoD rules last so they win over grants.
 */
export function buildRules(input: AbilityInput): AppRawRule[] {
  const rules: AppRawRule[] = [];
  for (const grant of input.grants) {
    const context: RuleContext = { userId: input.userId, scope: grant.scope };
    for (const definition of grant.rules) {
      const resolved = resolveRule(definition, context);
      if (resolved !== undefined) rules.push(resolved);
    }
  }
  if (input.settings?.separationOfDuties ?? true) {
    rules.push(...(separationOfDutiesRules(input.userId) as AppRawRule[]));
  }
  return rules;
}

export function createAbility(rules: readonly AppRawRule[]): AppAbility {
  return createMongoAbility<AppAbility>([...rules]);
}

export function defineAbilityFor(input: AbilityInput): AppAbility {
  return createAbility(buildRules(input));
}

/** Compact, JSON-safe form for `/v1/me/permissions` (CASL packRules). */
export function serializeRules(rules: readonly AppRawRule[]): PackRule<AppRawRule>[] {
  return packRules([...rules]);
}

export function abilityFromSerialized(packed: readonly PackRule<AppRawRule>[]): AppAbility {
  return createAbility(unpackRules([...packed]));
}

export class AccessDeniedError extends Error {
  constructor(
    readonly action: Action,
    readonly subjectType: string,
    readonly reason?: string,
  ) {
    super(`Not allowed: ${action} ${subjectType}`);
    this.name = 'AccessDeniedError';
  }
}

/** Throws `AccessDeniedError` (mapped to 403 problem+json by the API). */
export function assertCan(
  ability: AppAbility,
  action: Action,
  target: AppSubject,
  field?: string,
): void {
  try {
    ForbiddenError.from(ability).throwUnlessCan(action, target, field);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      const rule = ability.relevantRuleFor(action, target, field);
      const reason = rule?.inverted ? rule.reason : undefined;
      throw new AccessDeniedError(action, error.subjectType, reason);
    }
    throw error;
  }
}

export const MASK = '•••';

/**
 * Field-level PII: returns a copy where every `@pii` field the ability may not `reveal` is masked.
 * Absent fields stay absent.
 */
export function redactPii<T extends SubjectRecord>(
  ability: AppAbility,
  type: ConcreteSubject,
  record: T,
): T {
  const fields = PII_FIELDS[type] ?? [];
  if (fields.length === 0) return { ...record };
  const target = asSubject(type, record);
  const out: SubjectRecord = { ...record };
  for (const field of fields) {
    if (!(field in out)) continue;
    if (!ability.can('reveal', target, field)) out[field] = MASK;
  }
  return out as T;
}
