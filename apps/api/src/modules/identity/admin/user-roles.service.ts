import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { NotFoundError } from '../../../common/errors/domain-errors.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { RoleSync } from '../login/role-sync.js';

export const SetUserRolesSchema = z
  .strictObject({ roles: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,62}$/)).max(50) })
  .meta({ id: 'SetUserRoles' });
export const UserRoleAssignmentsSchema = z
  .object({
    userId: z.uuid(),
    roles: z.array(z.object({ name: z.string(), source: z.string() })),
  })
  .meta({ id: 'UserRoleAssignments' });

/** Manual role assignments (source `manual`); IdP- and SCIM-sourced roles are read-only here. */
@Injectable()
export class UserRolesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RoleSync) private readonly roles: RoleSync,
  ) {}

  async get(userId: string) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (user === null) throw new NotFoundError('User');
    const links = await tx.userRole.findMany({
      where: { tenantId, userId, deletedAt: null, role: { deletedAt: null } },
      select: { source: true, role: { select: { name: true } } },
      orderBy: [{ source: 'asc' }],
    });
    return {
      userId,
      roles: links
        .map((link) => ({ name: link.role.name, source: link.source }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async setManual(userId: string, names: readonly string[]) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (user === null) throw new NotFoundError('User');
    const known = await tx.role.count({
      where: { tenantId, deletedAt: null, name: { in: [...names] } },
    });
    if (known !== new Set(names).size) throw new NotFoundError('Role');
    await this.roles.sync(tx, tenantId, userId, 'manual', [...new Set(names)]);
    return this.get(userId);
  }
}
