import { z } from 'zod';

import { RuleDefinitionSchema, type RuleDefinition } from './rules.js';
import {
  ActionSchema,
  PII_FIELDS,
  RESOURCE_ACTIONS,
  RESOURCE_SUBJECT,
  RESOURCES,
  ResourceSchema,
  type Action,
  type Resource,
} from './vocabulary.js';

import type { AppAbility } from './ability.js';

/** ABAC scope of a matrix cell: whose records the permission covers. */
export const SCOPE_KINDS = ['all', 'campaign', 'team', 'site', 'own'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Attribute (and placeholder) each resource is scoped by, per scope kind. */
export const SCOPE_FIELDS: Readonly<
  Record<Resource, Partial<Record<Exclude<ScopeKind, 'all'>, { field: string; value: string }>>>
> = {
  campaign: {
    campaign: { field: 'id', value: '${scope.campaignIds}' },
    team: { field: 'teamIds', value: '${scope.teamIds}' },
    site: { field: 'siteIds', value: '${scope.siteIds}' },
  },
  script: { campaign: { field: 'campaignIds', value: '${scope.campaignIds}' } },
  screen: { campaign: { field: 'campaignIds', value: '${scope.campaignIds}' } },
  integration: {},
  secret: {},
  connector: {},
  user: {
    team: { field: 'teamIds', value: '${scope.teamIds}' },
    site: { field: 'siteIds', value: '${scope.siteIds}' },
    own: { field: 'id', value: '${user.id}' },
  },
  role: {},
  idp: {},
  audit: {},
  report: {
    campaign: { field: 'campaignId', value: '${scope.campaignIds}' },
    team: { field: 'teamId', value: '${scope.teamIds}' },
    site: { field: 'siteId', value: '${scope.siteIds}' },
  },
  session: {
    campaign: { field: 'campaignId', value: '${scope.campaignIds}' },
    team: { field: 'teamId', value: '${scope.teamIds}' },
    site: { field: 'siteId', value: '${scope.siteIds}' },
    own: { field: 'agentId', value: '${user.id}' },
  },
};

const MatrixCellSchema = z
  .object({
    actions: z.array(ActionSchema).min(1).max(10),
    scope: z.enum(SCOPE_KINDS).default('all'),
    /** May see this resource's `@pii` fields (adds `reveal` on those fields, same scope). */
    revealPii: z.boolean().default(false),
  })
  .strict();

const CustomRoleObject = z
  .object({
    name: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    description: z.string().max(500).optional(),
    matrix: z.partialRecord(ResourceSchema, MatrixCellSchema),
  })
  .strict();

function checkMatrix(
  role: { matrix: Partial<Record<Resource, MatrixCell>> },
  ctx: z.RefinementCtx,
): void {
  {
    for (const [resource, cell] of Object.entries(role.matrix) as [Resource, MatrixCell][]) {
      const allowed = RESOURCE_ACTIONS[resource];
      for (const action of cell.actions) {
        if (!allowed.includes(action)) {
          ctx.addIssue({
            code: 'custom',
            path: ['matrix', resource, 'actions'],
            message: `Action "${action}" does not apply to ${resource}`,
          });
        }
      }
      if (cell.scope !== 'all' && SCOPE_FIELDS[resource][cell.scope] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['matrix', resource, 'scope'],
          message: `${resource} cannot be scoped by ${cell.scope}`,
        });
      }
      if (cell.revealPii && (PII_FIELDS[RESOURCE_SUBJECT[resource]] ?? []).length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['matrix', resource, 'revealPii'],
          message: `${resource} has no PII fields`,
        });
      }
    }
  }
}

export const CustomRoleSchema = CustomRoleObject.superRefine(checkMatrix);
/** Body of a matrix update: the name is immutable. */
export const CustomRoleUpdateSchema = CustomRoleObject.omit({ name: true }).superRefine(
  checkMatrix,
);
export type CustomRoleInput = z.input<typeof CustomRoleSchema>;
export type CustomRole = z.output<typeof CustomRoleSchema>;
type MatrixCell = z.output<typeof MatrixCellSchema>;

/** Permission matrix (resource × action, with scope) → rule definitions. */
export function matrixToRules(matrix: CustomRole['matrix']): RuleDefinition[] {
  const rules: RuleDefinition[] = [];
  for (const resource of RESOURCES) {
    const cell = matrix[resource];
    if (cell === undefined) continue;
    const subject = RESOURCE_SUBJECT[resource];
    const scoped = cell.scope === 'all' ? undefined : SCOPE_FIELDS[resource][cell.scope];
    const conditions =
      scoped === undefined ? undefined : { [scoped.field]: scopedValue(scoped.value) };
    const actions = [...new Set(cell.actions)];
    rules.push(
      conditions === undefined
        ? { action: actions, subject }
        : { action: actions, subject, conditions },
    );
    if (cell.revealPii) {
      const fields = [...(PII_FIELDS[subject] ?? [])];
      rules.push(
        conditions === undefined
          ? { action: 'reveal', subject, fields }
          : { action: 'reveal', subject, fields, conditions },
      );
    }
  }
  return rules.map((rule) => RuleDefinitionSchema.parse(rule) as RuleDefinition);
}

/** `${user.id}` is a scalar; scope placeholders are sets. */
function scopedValue(value: string): string | { $in: string } {
  return value === '${user.id}' ? value : { $in: value };
}

/** Rules → matrix (for the role editor); conditions are reported as their scope kind. */
export function rulesToMatrix(
  rules: readonly RuleDefinition[],
): Partial<Record<Resource, Action[]>> {
  const out: Partial<Record<Resource, Action[]>> = {};
  const bySubject = new Map<string, Resource>(
    RESOURCES.map((resource) => [RESOURCE_SUBJECT[resource], resource]),
  );
  for (const rule of rules) {
    if (rule.inverted === true || rule.fields !== undefined) continue;
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
    for (const subject of subjects) {
      const resources = subject === 'all' ? [...RESOURCES] : [bySubject.get(subject)];
      for (const resource of resources) {
        if (resource === undefined) continue;
        const expanded = actions.includes('manage') ? [...RESOURCE_ACTIONS[resource]] : actions;
        out[resource] = [...new Set([...(out[resource] ?? []), ...expanded])].sort();
      }
    }
  }
  return out;
}

/**
 * Privilege-escalation guard: whoever creates or edits a role may only grant what they hold
 * themselves (type level, ignoring conditions on their side).
 */
export function findEscalations(
  granter: AppAbility,
  rules: readonly RuleDefinition[],
): { action: Action; subject: string }[] {
  const escalations: { action: Action; subject: string }[] = [];
  for (const rule of rules) {
    if (rule.inverted === true) continue;
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
    for (const subject of subjects) {
      for (const action of actions) {
        const holds =
          rule.fields === undefined
            ? granter.can(action, subject)
            : rule.fields.every((field) => granter.can(action, subject, field));
        if (!holds) escalations.push({ action, subject });
      }
    }
  }
  return escalations;
}
