import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';

import type { ChannelListQuery, ConnectorListQuery } from './connectors.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const CONNECTOR_SELECT = {
  id: true,
  adapterType: true,
  platform: true,
  status: true,
  health: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ConnectorSelect;
export type ConnectorRow = Prisma.ConnectorGetPayload<{ select: typeof CONNECTOR_SELECT }>;
const CHANNEL_SELECT = {
  id: true,
  type: true,
  provider: true,
  config: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ChannelSelect;
export type ChannelRow = Prisma.ChannelGetPayload<{ select: typeof CHANNEL_SELECT }>;

@Injectable()
export class ConnectorsRepository {
  listConnectors(
    tx: TransactionClient,
    tenantId: string,
    query: ConnectorListQuery,
  ): Promise<ConnectorRow[]> {
    const { adapterType, status } = query.filters;
    const where: Prisma.ConnectorWhereInput = {
      tenantId,
      deletedAt: null,
      ...(adapterType === undefined ? {} : { adapterType }),
      ...(status === undefined ? {} : { status }),
    };
    const after = keysetWhere(query) as Prisma.ConnectorWhereInput | undefined;
    return tx.connector.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: CONNECTOR_SELECT,
    });
  }

  listChannels(
    tx: TransactionClient,
    tenantId: string,
    query: ChannelListQuery,
  ): Promise<ChannelRow[]> {
    const where: Prisma.ChannelWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.filters.type === undefined ? {} : { type: query.filters.type }),
    };
    const after = keysetWhere(query) as Prisma.ChannelWhereInput | undefined;
    return tx.channel.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: CHANNEL_SELECT,
    });
  }
}
