import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../../common/pagination/pagination.js';

import type { LocationListQuery, LocationRow } from './locations.dto.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../infra/database/prisma.service.js';

const SELECT = {
  id: true,
  code: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.LocationSelect;

/** Every query filters by tenant and runs inside the tenant transaction (RLS); soft-deleted rows are hidden. */
@Injectable()
export class LocationsRepository {
  list(tx: TransactionClient, tenantId: string, query: LocationListQuery): Promise<LocationRow[]> {
    const { q } = query.filters;
    const where: Prisma.LocationWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q === undefined
        ? {}
        : {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          }),
    };
    const after = keysetWhere(query) as Prisma.LocationWhereInput | undefined;
    return tx.location.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SELECT,
    });
  }

  find(tx: TransactionClient, tenantId: string, id: string): Promise<LocationRow | null> {
    return tx.location.findFirst({ where: { id, tenantId, deletedAt: null }, select: SELECT });
  }

  findByCode(tx: TransactionClient, tenantId: string, code: string): Promise<LocationRow | null> {
    return tx.location.findFirst({ where: { code, tenantId, deletedAt: null }, select: SELECT });
  }

  create(
    tx: TransactionClient,
    tenantId: string,
    input: { code: string; name: string },
    actor: string,
  ): Promise<LocationRow> {
    return tx.location.create({
      data: { tenantId, code: input.code, name: input.name, createdBy: actor, updatedBy: actor },
      select: SELECT,
    });
  }

  async rename(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    name: string,
    actor: string,
  ): Promise<LocationRow | null> {
    const result = await tx.location.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data: { name, updatedBy: actor, version: { increment: 1 } },
    });
    return result.count === 0 ? null : this.find(tx, tenantId, id);
  }

  async softDelete(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor: string,
  ): Promise<boolean> {
    const result = await tx.location.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data: { deletedAt: new Date(), updatedBy: actor, version: { increment: 1 } },
    });
    return result.count > 0;
  }
}
