import { Controller, Get, Inject } from '@nestjs/common';

import { ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  ChannelListQuerySchema,
  ChannelPageSchema,
  ConnectorListQuerySchema,
  ConnectorPageSchema,
  type ChannelListQuery,
  type ConnectorListQuery,
} from './connectors.dto.js';
import { ConnectorsService } from './connectors.service.js';

@ApiTag('connectors')
@Controller('v1')
export class ConnectorsController {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  @ApiOperation({ summary: 'List connectors' })
  @ApiResponse(200, 'A page of connectors', ConnectorPageSchema)
  @RequirePermissions('read:Connector')
  @Get('connectors')
  listConnectors(@ZQuery(ConnectorListQuerySchema) query: ConnectorListQuery) {
    return this.connectors.listConnectors(query);
  }

  @ApiOperation({ summary: 'List channels' })
  @ApiResponse(200, 'A page of channels', ChannelPageSchema)
  @RequirePermissions('read:Channel')
  @Get('channels')
  listChannels(@ZQuery(ChannelListQuerySchema) query: ChannelListQuery) {
    return this.connectors.listChannels(query);
  }
}
