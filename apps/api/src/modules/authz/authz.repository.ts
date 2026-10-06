import { Injectable } from '@nestjs/common';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

export interface RoleGrantRow {
  readonly name: string;
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
  readonly rules: unknown;
  readonly scope: unknown;
}

@Injectable()
export class AuthzRepository {
  /**
   * Active role assignments of the user, each with its own ABAC scope (tenant-scoped by RLS and
   * filter). `undefined` when the user is missing or not active.
   */
  async grantsForUser(
    tx: TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<RoleGrantRow[] | undefined> {
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: {
        status: true,
        roles: {
          where: { deletedAt: null, role: { deletedAt: null } },
          select: {
            scope: true,
            role: { select: { name: true, isSystem: true, permissions: true, rules: true } },
          },
        },
      },
    });
    if (user?.status !== 'active') return undefined;
    return user.roles.map((link) => ({ ...link.role, scope: link.scope }));
  }
}
