import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  buildRules,
  createAbility,
  isSystemRoleKey,
  legacyPermissionsToRules,
  RuleDefinitionSchema,
  ScopeSchema,
  SYSTEM_ROLES,
  type AppAbility,
  type AppRawRule,
  type Grant,
  type RuleDefinition,
} from '@verbis/authz';

import { AuthzRepository, type RoleGrantRow } from './authz.repository.js';
import { parseRequirement } from './permissions.js';

import type { Principal } from '../../common/security/principal.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

/** `tenants.settings.authz` (loose: unknown keys elsewhere in settings are ignored). */
export const TenantAuthzSettingsSchema = z
  .object({
    /** Only the platform operator's tenant may hold `super_admin`. */
    platform: z.boolean().default(false),
    authz: z.object({ separationOfDuties: z.boolean().default(true) }).prefault({}),
  })
  .loose();
export type TenantAuthzSettings = z.infer<typeof TenantAuthzSettingsSchema>;

export interface ResolvedAbility {
  readonly ability: AppAbility;
  readonly rules: readonly AppRawRule[];
  readonly roles: readonly string[];
  readonly separationOfDuties: boolean;
}

const RulesSchema = z.array(RuleDefinitionSchema).max(500);
const UNRESTRICTED = { campaignIds: '*', teamIds: '*', siteIds: '*' } as const;

export function parseTenantAuthzSettings(settings: unknown): TenantAuthzSettings {
  const parsed = TenantAuthzSettingsSchema.safeParse(settings ?? {});
  return parsed.success ? parsed.data : { platform: false, authz: { separationOfDuties: true } };
}

/**
 * A stored role → grant. System roles take their rules from code (`@verbis/authz`), so rule
 * changes ship with releases; custom roles use their `rules` column. Invalid stored data grants
 * nothing (fail closed). Legacy permission strings still contribute unconditional rules.
 */
export function grantFromRow(row: RoleGrantRow, settings: TenantAuthzSettings): Grant | undefined {
  const scope = ScopeSchema.safeParse(row.scope ?? {});
  const grantScope = scope.success ? scope.data : {};
  if (row.isSystem && isSystemRoleKey(row.name)) {
    const definition = SYSTEM_ROLES[row.name];
    if (definition.platform && !settings.platform) return undefined;
    return { rules: definition.rules, scope: grantScope };
  }
  const stored = RulesSchema.safeParse(row.rules ?? []);
  const rules: RuleDefinition[] = [
    ...(stored.success ? (stored.data as RuleDefinition[]) : []),
    ...legacyPermissionsToRules(row.permissions),
  ];
  return { rules, scope: grantScope };
}

@Injectable()
export class AbilityFactory {
  constructor(@Inject(AuthzRepository) private readonly repository: AuthzRepository) {}

  /** `undefined` when the user is not active in the tenant. */
  async forPrincipal(
    tx: TransactionClient,
    principal: Principal,
    tenantSettings: unknown,
  ): Promise<ResolvedAbility | undefined> {
    const settings = parseTenantAuthzSettings(tenantSettings);
    const separationOfDuties = settings.authz.separationOfDuties;
    if (principal.type === 'service') {
      // Service scopes are legacy strings; they never carry ABAC placeholders.
      const rules = buildRules({
        userId: `service:${principal.id}`,
        grants: [
          {
            rules: principal.scopes.flatMap((value) => {
              const scope = parseRequirement(value);
              return scope ? [{ action: scope.action, subject: scope.subject }] : [];
            }),
            scope: UNRESTRICTED,
          },
        ],
        settings: { separationOfDuties },
      });
      return { ability: createAbility(rules), rules, roles: [], separationOfDuties };
    }
    const rows = await this.repository.grantsForUser(tx, principal.tenantId, principal.id);
    if (rows === undefined) return undefined;
    const grants = rows.flatMap((row) => {
      const grant = grantFromRow(row, settings);
      return grant === undefined ? [] : [grant];
    });
    const rules = buildRules({ userId: principal.id, grants, settings: { separationOfDuties } });
    return {
      ability: createAbility(rules),
      rules,
      roles: [...new Set(rows.map((row) => row.name))].sort(),
      separationOfDuties,
    };
  }
}
