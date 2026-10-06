import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';

import type { ScreenListQuery } from './screens.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const SELECT = {
  id: true,
  scriptVersionId: true,
  key: true,
  title: true,
  entry: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ScreenSelect;
export type ScreenRow = Prisma.ScreenGetPayload<{ select: typeof SELECT }>;

const DETAIL_SELECT = {
  ...SELECT,
  layoutRoot: true,
  components: {
    where: { deletedAt: null },
    orderBy: { key: 'asc' },
    select: { id: true, key: true, type: true, props: true, bindings: true, events: true },
  },
} satisfies Prisma.ScreenSelect;
export type ScreenWithComponentsRow = Prisma.ScreenGetPayload<{ select: typeof DETAIL_SELECT }>;

/** Read model rows are written by the scripts module's projection. */
@Injectable()
export class ScreensRepository {
  versionExists(
    tx: TransactionClient,
    tenantId: string,
    scriptVersionId: string,
  ): Promise<boolean> {
    return tx.scriptVersion
      .count({ where: { id: scriptVersionId, tenantId, deletedAt: null } })
      .then((count) => count === 1);
  }

  list(
    tx: TransactionClient,
    tenantId: string,
    scriptVersionId: string,
    query: ScreenListQuery,
  ): Promise<ScreenRow[]> {
    const where: Prisma.ScreenWhereInput = {
      tenantId,
      scriptVersionId,
      deletedAt: null,
      ...(query.filters.entry === undefined ? {} : { entry: query.filters.entry }),
    };
    const after = keysetWhere(query) as Prisma.ScreenWhereInput | undefined;
    return tx.screen.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SELECT,
    });
  }

  find(
    tx: TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<ScreenWithComponentsRow | null> {
    return tx.screen.findFirst({ where: { id, tenantId, deletedAt: null }, select: DETAIL_SELECT });
  }
}
