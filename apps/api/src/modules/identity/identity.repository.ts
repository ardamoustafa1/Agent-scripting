import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';

import type { GroupListQuery, IdpListQuery, RoleListQuery, UserListQuery } from './identity.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

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
  roles: { where: { deletedAt: null }, select: { role: { select: { name: true } } } },
} satisfies Prisma.UserSelect;
export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.RoleSelect;
export type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

const GROUP_SELECT = {
  id: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.GroupSelect;
export type GroupRow = Prisma.GroupGetPayload<{ select: typeof GROUP_SELECT }>;

export const IDP_SELECT = {
  id: true,
  protocol: true,
  displayName: true,
  domainHints: true,
  jitProvisioning: true,
  scimEnabled: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.IdentityProviderSelect;
export type IdpRow = Prisma.IdentityProviderGetPayload<{ select: typeof IDP_SELECT }>;

const and = <W>(where: W, after: unknown): W | { AND: unknown[] } =>
  after === undefined ? where : { AND: [where, after] };

@Injectable()
export class IdentityRepository {
  listUsers(tx: TransactionClient, tenantId: string, query: UserListQuery): Promise<UserRow[]> {
    const where: Prisma.UserWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.filters.status === undefined ? {} : { status: query.filters.status }),
      ...(query.filters.q === undefined
        ? {}
        : {
            OR: [
              { displayName: { contains: query.filters.q, mode: 'insensitive' } },
              { email: { contains: query.filters.q, mode: 'insensitive' } },
            ],
          }),
    };
    return tx.user.findMany({
      where: and(where, keysetWhere(query)) as Prisma.UserWhereInput,
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: USER_SELECT,
    });
  }

  findUser(tx: TransactionClient, tenantId: string, id: string): Promise<UserRow | null> {
    return tx.user.findFirst({ where: { id, tenantId, deletedAt: null }, select: USER_SELECT });
  }

  listRoles(tx: TransactionClient, tenantId: string, query: RoleListQuery): Promise<RoleRow[]> {
    return tx.role.findMany({
      where: and({ tenantId, deletedAt: null }, keysetWhere(query)) as Prisma.RoleWhereInput,
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: ROLE_SELECT,
    });
  }

  listGroups(tx: TransactionClient, tenantId: string, query: GroupListQuery): Promise<GroupRow[]> {
    const where: Prisma.GroupWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.filters.q === undefined
        ? {}
        : { displayName: { contains: query.filters.q, mode: 'insensitive' } }),
    };
    return tx.group.findMany({
      where: and(where, keysetWhere(query)) as Prisma.GroupWhereInput,
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: GROUP_SELECT,
    });
  }

  listIdps(tx: TransactionClient, tenantId: string, query: IdpListQuery): Promise<IdpRow[]> {
    const where: Prisma.IdentityProviderWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.filters.status === undefined ? {} : { status: query.filters.status }),
    };
    return tx.identityProvider.findMany({
      where: and(where, keysetWhere(query)) as Prisma.IdentityProviderWhereInput,
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: IDP_SELECT,
    });
  }
}
