import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  findEscalations,
  matrixToRules,
  RESOURCE_ACTIONS,
  RuleDefinitionSchema,
  RESOURCES,
  rulesToMatrix,
  SCOPE_FIELDS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLES,
  type CustomRole,
  type RuleDefinition,
} from '@verbis/authz';

import { currentActor } from '../../common/actor.js';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';

import { AuthzService } from './authz.service.js';

import type { RoleDto, RoleScopeAssignment } from './authz.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  rules: Prisma.JsonValue;
  version: number;
}

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: true,
  rules: true,
  version: true,
} as const;

const StoredRulesSchema = z.array(RuleDefinitionSchema).max(500);

/** Invalid stored rules grant nothing (fail closed), exactly like `grantFromRow`. */
function storedRules(row: RoleRow): RuleDefinition[] {
  if (row.isSystem && (SYSTEM_ROLE_KEYS as readonly string[]).includes(row.name))
    return [...SYSTEM_ROLES[row.name as keyof typeof SYSTEM_ROLES].rules];
  const parsed = StoredRulesSchema.safeParse(row.rules);
  return parsed.success ? (parsed.data as RuleDefinition[]) : [];
}

export function toRoleDto(row: RoleRow): RoleDto {
  const rules = storedRules(row);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    matrix: rulesToMatrix(rules),
    rules,
    version: row.version,
  };
}

/** Custom roles (permission matrix) and ABAC scopes of role assignments. */
@Injectable()
export class RolesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  vocabulary() {
    return {
      resources: [...RESOURCES],
      actions: Object.fromEntries(RESOURCES.map((r) => [r, [...RESOURCE_ACTIONS[r]]])),
      scopes: Object.fromEntries(
        RESOURCES.map((r) => [r, ['all', ...Object.keys(SCOPE_FIELDS[r])]]),
      ),
      systemRoles: SYSTEM_ROLE_KEYS.map((key) => ({
        key,
        labelKey: SYSTEM_ROLES[key].labelKey,
        matrix: rulesToMatrix(SYSTEM_ROLES[key].rules),
      })),
    };
  }

  async list(): Promise<RoleDto[]> {
    const rows = await this.db.current().role.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    });
    return rows.map(toRoleDto);
  }

  async create(input: CustomRole): Promise<RoleDto> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    if ((SYSTEM_ROLE_KEYS as readonly string[]).includes(input.name))
      throw new ConflictError('The name is reserved for a system role');
    const exists = await tx.role.findFirst({
      where: { tenantId, name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (exists !== null) throw new ConflictError('A role with this name exists');
    const rules = this.checkedRules(input.matrix);
    const actor = currentActor();
    const row = await tx.role.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        permissions: [],
        rules: rules as unknown as Prisma.InputJsonValue,
        isSystem: false,
        createdBy: actor,
        updatedBy: actor,
      },
      select: ROLE_SELECT,
    });
    const dto = toRoleDto(row);
    await this.audit.record(tx, {
      action: 'authz.role.created',
      target: { type: 'Role', id: row.id, name: row.name },
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.authz.role.created.v1',
      aggregateType: 'Role',
      aggregateId: row.id,
      payload: { role: dto },
    });
    return dto;
  }

  async update(
    id: string,
    expectedVersion: number,
    input: Omit<CustomRole, 'name'>,
  ): Promise<RoleDto> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const before = await tx.role.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: ROLE_SELECT,
    });
    if (before === null) throw new NotFoundError('Role');
    if (before.isSystem) throw new ForbiddenError('System roles cannot be changed');
    if (before.version !== expectedVersion) throw new VersionMismatchError(before.version);
    const rules = this.checkedRules(input.matrix);
    const result = await tx.role.updateMany({
      where: { id, tenantId, version: expectedVersion, deletedAt: null },
      data: {
        description: input.description ?? null,
        rules: rules as unknown as Prisma.InputJsonValue,
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new VersionMismatchError();
    const row = await tx.role.findFirstOrThrow({ where: { id, tenantId }, select: ROLE_SELECT });
    const dto = toRoleDto(row);
    await this.audit.record(tx, {
      action: 'authz.role.updated',
      target: { type: 'Role', id, name: row.name },
      before: toRoleDto(before),
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.authz.role.updated.v1',
      aggregateType: 'Role',
      aggregateId: id,
      payload: { role: dto },
    });
    return dto;
  }

  /** Sets scope on all active assignments of this role, including SSO/SCIM sources. */
  async setScope(userId: string, input: RoleScopeAssignment) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const links = await tx.userRole.findMany({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        role: { name: input.role, deletedAt: null },
      },
      select: { id: true, source: true, scope: true, version: true },
    });
    if (links.length === 0) throw new NotFoundError('Role assignment');
    // Scoping a role you could not grant yourself would be an escalation path too.
    const role = await tx.role.findFirstOrThrow({
      where: { tenantId, name: input.role, deletedAt: null },
      select: ROLE_SELECT,
    });
    this.assertGrantable(storedRules(role));
    const changed = await tx.userRole.updateMany({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        OR: links.map((link) => ({ id: link.id, version: link.version })),
      },
      data: {
        scope: input.scope,
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== links.length) throw new VersionMismatchError();
    await this.audit.record(tx, {
      action: 'authz.roleAssignment.scopeChanged',
      target: { type: 'User', id: userId },
      before: {
        role: input.role,
        assignments: links.map(({ source, scope }) => ({ source, scope })),
      },
      after: { role: input.role, scope: input.scope },
    });
    await this.outbox.record(tx, {
      type: 'verbis.authz.roleAssignment.scopeChanged.v1',
      aggregateType: 'User',
      aggregateId: userId,
      payload: { userId, role: input.role, scope: input.scope },
    });
    return { userId, role: input.role, scope: input.scope };
  }

  private checkedRules(matrix: CustomRole['matrix']): RuleDefinition[] {
    const rules = matrixToRules(matrix);
    this.assertGrantable(rules);
    return rules;
  }

  private assertGrantable(rules: readonly RuleDefinition[]): void {
    const escalations = findEscalations(this.authz.ability(), rules);
    if (escalations.length > 0) {
      throw new DomainError(
        'VERBIS_AUTHZ_PRIVILEGE_ESCALATION',
        'A role cannot grant permissions you do not hold',
        escalations.map((e) => ({ path: `${e.subject}.${e.action}`, message: 'not held' })),
      );
    }
  }
}
