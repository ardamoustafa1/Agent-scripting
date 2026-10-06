import { Inject, Injectable } from '@nestjs/common';

import { currentActor } from '../../../common/actor.js';
import { requestContext } from '../../../common/context/request-context.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { AuditService } from '../../audit/audit.service.js';
import { reserveTenantCapacity } from '../../tenancy/quota.js';
import { SESSION_STORE } from '../core/identity.tokens.js';
import { oidcClaimNames, samlAttributeNames } from '../idp/idp-config.js';
import { IdpRepository } from '../idp/idp.repository.js';
import { mapRoles } from '../idp/role-mapping.js';
import { RoleSync } from '../login/role-sync.js';
import { SessionService } from '../session/session.service.js';

import {
  compileScimFilter,
  dateAttribute,
  parseScimFilter,
  ScimFilterError,
  stringAttribute,
  type AttributeMap,
  type Where,
} from './scim-filter.js';
import { applyGroupPatch, applyUserPatch, type PatchRequest } from './scim-patch.js';
import { ScimError } from './scim.errors.js';
import {
  LIST_SCHEMA,
  toScimGroup,
  toScimUser,
  userStateFromInput,
  type GroupState,
  type ScimGroupInput,
  type ScimUserInput,
  type UserState,
} from './scim.resources.js';

import type { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../infra/database/prisma.service.js';
import type { SessionStore } from '../session/session-store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idAttribute = (column = 'id') => ({
  compare: (op: string, value: unknown) =>
    op === 'eq' && typeof value === 'string'
      ? UUID.test(value)
        ? { [column]: value }
        : { [column]: '00000000-0000-0000-0000-000000000000' }
      : undefined,
});

const USER_ATTRIBUTES: AttributeMap = {
  id: idAttribute(),
  userName: stringAttribute('email'),
  externalId: stringAttribute('externalId', { caseExact: true }),
  displayName: stringAttribute('displayName'),
  'name.formatted': stringAttribute('displayName'),
  emails: stringAttribute('email'),
  'emails.value': stringAttribute('email'),
  'emails.type': { compare: (op, value) => (op === 'eq' && value === 'work' ? {} : undefined) },
  'emails.primary': { compare: (op, value) => (op === 'eq' && value === true ? {} : undefined) },
  active: {
    compare: (op, value) =>
      (op === 'eq' || op === 'ne') && typeof value === 'boolean'
        ? { status: (op === 'eq') === value ? 'active' : { not: 'active' } }
        : undefined,
  },
  'meta.created': dateAttribute('createdAt'),
  'meta.lastModified': dateAttribute('updatedAt'),
  'groups.value': {
    compare: (op, value) =>
      op === 'eq' && typeof value === 'string' && UUID.test(value)
        ? { groups: { some: { groupId: value, deletedAt: null } } }
        : undefined,
  },
};

const GROUP_ATTRIBUTES: AttributeMap = {
  id: idAttribute(),
  displayName: stringAttribute('displayName'),
  externalId: stringAttribute('externalId', { caseExact: true }),
  'members.value': {
    compare: (op, value) =>
      op === 'eq' && typeof value === 'string' && UUID.test(value)
        ? { members: { some: { userId: value, deletedAt: null } } }
        : undefined,
  },
  'meta.created': dateAttribute('createdAt'),
  'meta.lastModified': dateAttribute('updatedAt'),
};

const USER_SELECT = {
  id: true,
  externalId: true,
  email: true,
  displayName: true,
  status: true,
  locale: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  groups: {
    where: { deletedAt: null, group: { deletedAt: null } },
    select: { group: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.UserSelect;

const GROUP_SELECT = {
  id: true,
  externalId: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  members: {
    where: { deletedAt: null, user: { deletedAt: null } },
    select: { user: { select: { id: true, email: true } } },
  },
} satisfies Prisma.GroupSelect;

export interface ListParams {
  readonly filter?: string;
  readonly startIndex: number;
  readonly count: number;
  readonly excludedAttributes?: string;
}

function compile(filter: string | undefined, attributes: AttributeMap): Where {
  if (filter === undefined || filter.trim() === '') return {};
  try {
    return compileScimFilter(parseScimFilter(filter), attributes);
  } catch (error) {
    if (error instanceof ScimFilterError) throw new ScimError(400, error.message, 'invalidFilter');
    throw error;
  }
}

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * SCIM 2.0 service provider for Users and Groups (RFC 7643/7644). Runs in the request
 * transaction of the `scim:<idpId>` principal: every change is audited; deactivation and
 * deletion revoke the user's sessions immediately (DOMAIN User); group changes re-sync the
 * IdP's SCIM-sourced roles through its role-mapping rules.
 */
@Injectable()
export class ScimService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(RoleSync) private readonly roles: RoleSync,
    @Inject(IdpRepository) private readonly idps: IdpRepository,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private idpId(): string {
    const id = requestContext.require().principal?.id ?? '';
    if (!id.startsWith('scim:')) throw new ScimError(403, 'SCIM credential required');
    return id.slice('scim:'.length);
  }

  baseUrl(slug: string): string {
    return `${this.env.PUBLIC_API_URL}/scim/v2/${slug}`;
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  async listUsers(slug: string, params: ListParams): Promise<Record<string, unknown>> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const where = {
      AND: [{ tenantId, deletedAt: null }, compile(params.filter, USER_ATTRIBUTES)],
    } as Prisma.UserWhereInput;
    const [total, rows] = await Promise.all([
      tx.user.count({ where }),
      tx.user.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: params.startIndex - 1,
        take: params.count,
        select: USER_SELECT,
      }),
    ]);
    return this.list(
      total,
      params.startIndex,
      rows.map((row) => toScimUser(row, this.baseUrl(slug))),
    );
  }

  async getUser(slug: string, id: string): Promise<Record<string, unknown>> {
    return toScimUser(await this.findUser(id), this.baseUrl(slug));
  }

  async createUser(slug: string, input: ScimUserInput): Promise<Record<string, unknown>> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const state = userStateFromInput(input);
    const actor = currentActor();
    let id: string;
    try {
      await reserveTenantCapacity(tx, tenantId, 'users');
      const row = await tx.user.create({
        data: {
          tenantId,
          email: state.email,
          displayName: state.displayName,
          externalId: state.externalId,
          ...(state.ctiIdentities === undefined ? {} : { ctiIdentities: state.ctiIdentities }),
          status: state.active ? 'active' : 'suspended',
          ...(state.locale !== null && /^[a-z]{2}/.test(state.locale)
            ? { locale: state.locale.slice(0, 2) }
            : {}),
          createdBy: actor,
          updatedBy: actor,
        },
        select: { id: true },
      });
      id = row.id;
    } catch (error) {
      if (uniqueViolation(error))
        throw new ScimError(409, 'A user with this userName or externalId exists', 'uniqueness');
      throw error;
    }
    await this.audit.record(tx, {
      action: 'identity.user.provisioned',
      target: { type: 'User', id },
      after: { source: 'scim', idpId: this.idpId(), status: state.active ? 'active' : 'suspended' },
    });
    await this.outbox.record(tx, {
      type: 'verbis.identity.user.provisioned.v1',
      aggregateType: 'User',
      aggregateId: id,
      payload: { source: 'scim', idpId: this.idpId() },
    });
    return this.getUser(slug, id);
  }

  async replaceUser(
    slug: string,
    id: string,
    input: ScimUserInput,
  ): Promise<Record<string, unknown>> {
    const current = await this.findUser(id);
    await this.saveUser(current, userStateFromInput(input));
    return this.getUser(slug, id);
  }

  async patchUser(slug: string, id: string, patch: PatchRequest): Promise<Record<string, unknown>> {
    const current = await this.findUser(id);
    await this.saveUser(current, applyUserPatch(this.stateOf(current), patch.Operations));
    return this.getUser(slug, id);
  }

  async deleteUser(id: string): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const current = await this.findUser(id);
    const actor = currentActor();
    const now = new Date();
    try {
      await tx.user.update({
        where: { id: current.id },
        data: {
          status: 'deprovisioned',
          deletedAt: now,
          updatedBy: actor,
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ScimError(409, 'conflict', 'uniqueness');
      throw error;
    }
    await tx.userIdentity.updateMany({
      where: { tenantId, userId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actor },
    });
    await tx.groupMember.updateMany({
      where: { tenantId, userId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actor },
    });
    await tx.userRole.updateMany({
      where: { tenantId, userId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actor },
    });
    await this.audit.record(tx, {
      action: 'identity.user.deprovisioned',
      target: { type: 'User', id },
      before: { status: current.status },
      after: { status: 'deprovisioned', source: 'scim' },
    });
    await this.deactivated(id, 'deprovisioned');
  }

  // ─── Groups ─────────────────────────────────────────────────────────────────

  async listGroups(slug: string, params: ListParams): Promise<Record<string, unknown>> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const where = {
      AND: [{ tenantId, deletedAt: null }, compile(params.filter, GROUP_ATTRIBUTES)],
    } as Prisma.GroupWhereInput;
    const includeMembers = !(params.excludedAttributes ?? '')
      .toLowerCase()
      .split(',')
      .includes('members');
    const [total, rows] = await Promise.all([
      tx.group.count({ where }),
      tx.group.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: params.startIndex - 1,
        take: params.count,
        select: GROUP_SELECT,
      }),
    ]);
    return this.list(
      total,
      params.startIndex,
      rows.map((row) => toScimGroup(row, this.baseUrl(slug), { includeMembers })),
    );
  }

  async getGroup(slug: string, id: string): Promise<Record<string, unknown>> {
    return toScimGroup(await this.findGroup(id), this.baseUrl(slug));
  }

  async createGroup(slug: string, input: ScimGroupInput): Promise<Record<string, unknown>> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const actor = currentActor();
    let id: string;
    try {
      const row = await tx.group.create({
        data: {
          tenantId,
          idpId: this.idpId(),
          displayName: input.displayName,
          externalId: input.externalId ?? null,
          createdBy: actor,
          updatedBy: actor,
        },
        select: { id: true },
      });
      id = row.id;
    } catch (error) {
      if (uniqueViolation(error))
        throw new ScimError(409, 'A group with this displayName exists', 'uniqueness');
      throw error;
    }
    await this.audit.record(tx, {
      action: 'identity.group.created',
      target: { type: 'Group', id, name: input.displayName },
      after: { idpId: this.idpId() },
    });
    await this.saveMembers(id, new Set(), new Set((input.members ?? []).map((m) => m.value)));
    return this.getGroup(slug, id);
  }

  async replaceGroup(
    slug: string,
    id: string,
    input: ScimGroupInput,
  ): Promise<Record<string, unknown>> {
    const current = await this.findGroup(id);
    await this.saveGroup(current, {
      displayName: input.displayName,
      externalId: input.externalId ?? null,
      members: new Set((input.members ?? []).map((m) => m.value)),
    });
    return this.getGroup(slug, id);
  }

  async patchGroup(
    slug: string,
    id: string,
    patch: PatchRequest,
  ): Promise<Record<string, unknown>> {
    const current = await this.findGroup(id);
    const state: GroupState = {
      displayName: current.displayName,
      externalId: current.externalId,
      members: new Set(current.members.map((m) => m.user.id)),
    };
    await this.saveGroup(current, applyGroupPatch(state, patch.Operations));
    return this.getGroup(slug, id);
  }

  async deleteGroup(id: string): Promise<void> {
    const tx = this.db.current();
    const current = await this.findGroup(id);
    await this.saveMembers(id, new Set(current.members.map((m) => m.user.id)), new Set());
    await tx.group.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: currentActor(), version: { increment: 1 } },
    });
    await this.audit.record(tx, {
      action: 'identity.group.deleted',
      target: { type: 'Group', id, name: current.displayName },
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private list(
    total: number,
    startIndex: number,
    resources: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  private async findUser(id: string) {
    if (!UUID.test(id)) throw new ScimError(404, 'User not found');
    const row = await this.db.current().user.findFirst({
      where: { id, tenantId: this.db.tenantId(), deletedAt: null },
      select: USER_SELECT,
    });
    if (row === null) throw new ScimError(404, 'User not found');
    return row;
  }

  private async findGroup(id: string) {
    if (!UUID.test(id)) throw new ScimError(404, 'Group not found');
    const row = await this.db.current().group.findFirst({
      where: { id, tenantId: this.db.tenantId(), deletedAt: null },
      select: GROUP_SELECT,
    });
    if (row === null) throw new ScimError(404, 'Group not found');
    return row;
  }

  private stateOf(row: Awaited<ReturnType<ScimService['findUser']>>): UserState {
    return {
      userName: row.email,
      email: row.email,
      externalId: row.externalId,
      displayName: row.displayName,
      active: row.status === 'active',
      locale: row.locale,
    };
  }

  private async saveUser(
    current: Awaited<ReturnType<ScimService['findUser']>>,
    next: UserState,
  ): Promise<void> {
    const tx = this.db.current();
    const before = this.stateOf(current);
    const status = next.active ? 'active' : 'suspended';
    // Match provisioning's two-letter locale and the User schema's default on removal.
    const locale =
      next.locale !== null && /^[a-z]{2}/.test(next.locale) ? next.locale.slice(0, 2) : 'tr';
    const changed =
      before.email !== next.email ||
      before.displayName !== next.displayName ||
      before.externalId !== next.externalId ||
      next.ctiIdentities !== undefined ||
      current.locale !== locale ||
      current.status !== status;
    if (!changed) return;
    try {
      await tx.user.update({
        where: { id: current.id },
        data: {
          email: next.email,
          displayName: next.displayName,
          externalId: next.externalId,
          ...(next.ctiIdentities === undefined ? {} : { ctiIdentities: next.ctiIdentities }),
          status,
          locale,
          updatedBy: currentActor(),
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ScimError(409, 'userName or externalId already in use', 'uniqueness');
      throw error;
    }
    await this.audit.record(tx, {
      action: 'identity.user.updated',
      target: { type: 'User', id: current.id },
      before: {
        email: before.email,
        displayName: before.displayName,
        externalId: before.externalId,
        status: current.status,
        locale: current.locale,
      },
      after: {
        email: next.email,
        displayName: next.displayName,
        externalId: next.externalId,
        status,
        locale,
        source: 'scim',
      },
    });
    if (current.status === 'active' && status !== 'active')
      await this.deactivated(current.id, 'suspended');
  }

  /** Revokes every session of the user and tells downstream consumers (launch intents). */
  private async deactivated(userId: string, status: 'suspended' | 'deprovisioned'): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    await this.audit.record(tx, {
      action: 'identity.user.deactivated',
      target: { type: 'User', id: userId },
      after: { status, source: 'scim' },
    });
    await this.outbox.record(tx, {
      type: 'verbis.identity.user.deactivated.v1',
      aggregateType: 'User',
      aggregateId: userId,
      payload: { status },
    });
    const revoked = await this.store.revokeAllForUser(tenantId, userId);
    await this.sessions.recordEndedInRequest(revoked, 'user_deactivated');
  }

  private async saveGroup(
    current: Awaited<ReturnType<ScimService['findGroup']>>,
    next: GroupState,
  ): Promise<void> {
    const tx = this.db.current();
    if (current.displayName !== next.displayName || current.externalId !== next.externalId) {
      try {
        await tx.group.update({
          where: { id: current.id },
          data: {
            displayName: next.displayName,
            externalId: next.externalId,
            updatedBy: currentActor(),
            version: { increment: 1 },
          },
        });
      } catch (error) {
        if (uniqueViolation(error))
          throw new ScimError(409, 'A group with this displayName exists', 'uniqueness');
        throw error;
      }
      await this.audit.record(tx, {
        action: 'identity.group.updated',
        target: { type: 'Group', id: current.id, name: next.displayName },
        before: { displayName: current.displayName, externalId: current.externalId },
        after: { displayName: next.displayName, externalId: next.externalId },
      });
    }
    const before = new Set(current.members.map((m) => m.user.id));
    await this.saveMembers(
      current.id,
      before,
      next.members,
      current.displayName !== next.displayName,
    );
  }

  private async saveMembers(
    groupId: string,
    before: Set<string>,
    after: Set<string>,
    renamed = false,
  ): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const actor = currentActor();
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    if (added.some((id) => !UUID.test(id)))
      throw new ScimError(400, 'members must reference user ids', 'invalidValue');
    if (added.length > 0) {
      const users = await tx.user.count({
        where: { tenantId, id: { in: added }, deletedAt: null },
      });
      if (users !== added.length) throw new ScimError(400, 'unknown member', 'invalidValue');
      await tx.groupMember.createMany({
        data: added.map((userId) => ({
          tenantId,
          groupId,
          userId,
          createdBy: actor,
          updatedBy: actor,
        })),
      });
    }
    if (removed.length > 0) {
      await tx.groupMember.updateMany({
        where: { tenantId, groupId, userId: { in: removed }, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: actor, version: { increment: 1 } },
      });
    }
    if (added.length > 0 || removed.length > 0) {
      await this.audit.record(tx, {
        action: 'identity.group.membersChanged',
        target: { type: 'Group', id: groupId },
        after: {
          added: added.length,
          removed: removed.length,
          addedIds: added,
          removedIds: removed,
        },
      });
    }
    const affected = renamed ? [...new Set([...before, ...after])] : [...added, ...removed];
    for (const userId of affected) await this.syncScimRoles(tx, tenantId, userId);
  }

  /** Roles from SCIM groups: the IdP's role-mapping rules evaluated over the user's group names. */
  private async syncScimRoles(
    tx: TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const idpId = this.idpId();
    const idp = await this.idps.find(tx, tenantId, idpId);
    if (idp === undefined) return;
    const groups = await tx.groupMember.findMany({
      where: { tenantId, userId, deletedAt: null, group: { deletedAt: null, idpId } },
      select: { group: { select: { displayName: true } } },
    });
    const names = groups.map((link) => link.group.displayName);
    const claim =
      idp.protocol === 'oidc'
        ? oidcClaimNames(idp.config).groups
        : samlAttributeNames(idp.config).groups;
    const desired = mapRoles(
      { rules: idp.config.roleMapping.rules, defaultRoles: [] },
      { groups: names, [claim]: names },
    );
    await this.roles.sync(tx, tenantId, userId, `scim:${idpId}`, desired);
  }
}
