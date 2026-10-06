import { Inject, Injectable } from '@nestjs/common';

import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';

import {
  type ChannelDto,
  type ChannelListQuery,
  type ConnectorDto,
  type ConnectorListQuery,
  toChannelDto,
  toConnectorDto,
} from './connectors.dto.js';
import { ConnectorsRepository } from './connectors.repository.js';

/** Connector instances and channels. Adapters run in apps/connector-hub (step 18+). */
@Injectable()
export class ConnectorsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ConnectorsRepository) private readonly repository: ConnectorsRepository,
  ) {}

  async listConnectors(query: ConnectorListQuery): Promise<Page<ConnectorDto>> {
    const rows = await this.repository.listConnectors(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toConnectorDto, (row, field) => row[field]);
  }

  async listChannels(query: ChannelListQuery): Promise<Page<ChannelDto>> {
    const rows = await this.repository.listChannels(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toChannelDto, (row, field) => row[field]);
  }
}
