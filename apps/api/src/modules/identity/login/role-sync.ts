import { Inject, Injectable, Logger } from '@nestjs/common';

import { currentActor } from '../../../common/actor.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { AuditService } from '../../audit/audit.service.js';

import type { TransactionClient } from '../../../infra/database/prisma.service.js';

export type RoleSource = 'manual' | `claims:${string}` | `scim:${string}`;

export interface RoleChange {
  readonly granted: string[];
  readonly revoked: string[];
}

/**
 * Synchronizes the roles a user holds from one source (manual, SSO claims of an IdP, SCIM groups
 * of an IdP) to the desired set. Other sources are never touched. Every grant/revocation is an
 * audit event (`identity.userRole.granted|revoked`) in the caller's transaction.
 */
@Injectable()
export class RoleSync {
  readonly #logger = new Logger(RoleSync.name);

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  async sync(
    tx: TransactionClient,
    tenantId: string,
    userId: string,
    source: RoleSource,
    desiredNames: readonly string[],
  ): Promise<RoleChange> {
    const roles = await tx.role.findMany({
      where: { tenantId, deletedAt: null, name: { in: [...desiredNames] } },
      select: { id: true, name: true },
    });
    const unknown = desiredNames.filter((name) => !roles.some((role) => role.name === name));
    if (unknown.length > 0)
      this.#logger.warn(`Role mapping references unknown roles (count=${String(unknown.length)})`);
    const current = await tx.userRole.findMany({
      where: { tenantId, userId, source, deletedAt: null },
      select: { id: true, roleId: true, role: { select: { name: true } } },
    });
    const desiredIds = new Set(roles.map((role) => role.id));
    const currentIds = new Set(current.map((link) => link.roleId));
    const actor = currentActor();
    const granted: string[] = [];
    const revoked: string[] = [];

    for (const role of roles) {
      if (currentIds.has(role.id)) continue;
      await tx.userRole.create({
        data: { tenantId, userId, roleId: role.id, source, createdBy: actor, updatedBy: actor },
      });
      granted.push(role.name);
    }
    for (const link of current) {
      if (desiredIds.has(link.roleId)) continue;
      await tx.userRole.update({
        where: { id: link.id },
        data: { deletedAt: new Date(), updatedBy: actor, version: { increment: 1 } },
      });
      revoked.push(link.role.name);
    }
    for (const name of granted.sort()) {
      await this.audit.record(tx, {
        action: 'identity.userRole.granted',
        target: { type: 'User', id: userId },
        after: { role: name, source },
      });
    }
    for (const name of revoked.sort()) {
      await this.audit.record(tx, {
        action: 'identity.userRole.revoked',
        target: { type: 'User', id: userId },
        before: { role: name, source },
      });
    }
    if (granted.length > 0 || revoked.length > 0) {
      await this.outbox.record(tx, {
        type: 'verbis.identity.user.rolesChanged.v1',
        aggregateType: 'User',
        aggregateId: userId,
        payload: { source, granted, revoked },
      });
    }
    return { granted, revoked };
  }
}
