import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';

import type { DataSourceListQuery, SecretListQuery } from './integrations.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const DS_SELECT = {
  id: true,
  key: true,
  protocol: true,
  definition: true,
  secretRefs: true,
  policy: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.DataSourceSelect;
export type DataSourceRow = Prisma.DataSourceGetPayload<{ select: typeof DS_SELECT }>;

const SECRET_SELECT = {
  id: true,
  name: true,
  kind: true,
  keyVersion: true,
  rotatedAt: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.SecretSelect;
export type SecretMetadataRow = Prisma.SecretGetPayload<{ select: typeof SECRET_SELECT }>;

@Injectable()
export class IntegrationsRepository {
  listDataSources(
    tx: TransactionClient,
    tenantId: string,
    query: DataSourceListQuery,
  ): Promise<DataSourceRow[]> {
    const where: Prisma.DataSourceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.filters.protocol === undefined ? {} : { protocol: query.filters.protocol }),
    };
    const after = keysetWhere(query) as Prisma.DataSourceWhereInput | undefined;
    return tx.dataSource.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: DS_SELECT,
    });
  }

  listSecrets(
    tx: TransactionClient,
    tenantId: string,
    query: SecretListQuery,
  ): Promise<SecretMetadataRow[]> {
    const after = keysetWhere(query) as Prisma.SecretWhereInput | undefined;
    const where: Prisma.SecretWhereInput = { tenantId, deletedAt: null };
    return tx.secret.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SECRET_SELECT,
    });
  }
}
