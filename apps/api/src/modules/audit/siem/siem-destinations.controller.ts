import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';

import { UuidSchema } from '../../../common/dto.js';
import { expectedVersion, setEtag } from '../../../common/http/if-match.js';
import { ZBody, ZParam } from '../../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag, RequiresIfMatch } from '../../../openapi/metadata.js';
import { Can } from '../../authz/permissions.js';

import {
  CreateSiemDestinationSchema,
  SiemDestinationSchema,
  SiemDestinationsService,
  UpdateSiemDestinationSchema,
  type CreateSiemDestination,
} from './siem-destinations.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTag('audit')
@Controller('v1/siem-destinations')
export class SiemDestinationsController {
  constructor(@Inject(SiemDestinationsService) private readonly service: SiemDestinationsService) {}

  @ApiOperation({ summary: 'SIEM destinations with delivery status' })
  @ApiResponse(200, 'Destinations', SiemDestinationSchema)
  @Can('read', 'Audit')
  @Get()
  list() {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Add a SIEM destination (syslog TLS, HMAC webhook, Kafka)' })
  @ApiResponse(201, 'Created', SiemDestinationSchema, { etag: 'Current version' })
  @Can('update', 'Tenant')
  @HttpCode(201)
  @Post()
  async create(
    @ZBody(CreateSiemDestinationSchema) body: CreateSiemDestination,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const dto = await this.service.create(body);
    setEtag(reply, dto.version);
    return dto;
  }

  @ApiOperation({ summary: 'Enable or disable a SIEM destination' })
  @ApiResponse(200, 'Updated', SiemDestinationSchema, { etag: 'New version' })
  @Can('update', 'Tenant')
  @RequiresIfMatch()
  @Patch(':id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateSiemDestinationSchema) body: { enabled: boolean },
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const dto = await this.service.setEnabled(id, expectedVersion(request), body.enabled);
    setEtag(reply, dto.version);
    return dto;
  }

  @ApiOperation({ summary: 'Remove a SIEM destination (soft delete; cursor kept for the record)' })
  @ApiResponse(204, 'Deleted')
  @Can('update', 'Tenant')
  @RequiresIfMatch()
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.service.remove(id, expectedVersion(request));
  }
}
