import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';

import { UuidSchema } from '../../../common/dto.js';
import { expectedVersion, setEtag } from '../../../common/http/if-match.js';
import { ZBody, ZParam, ZQuery } from '../../../common/validation/zod.js';
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  Idempotent,
  RequiresIfMatch,
} from '../../../openapi/metadata.js';
import { RequirePermissions } from '../../authz/permissions.js';

import {
  CreateLocationSchema,
  LocationListQuerySchema,
  LocationPageSchema,
  LocationSchema,
  UpdateLocationSchema,
  type CreateLocationInput,
  type LocationDto,
  type LocationListQuery,
  type UpdateLocationInput,
} from './locations.dto.js';
import { LocationsService } from './locations.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTag('tenancy')
@Controller('v1/locations')
export class LocationsController {
  constructor(@Inject(LocationsService) private readonly locations: LocationsService) {}

  @ApiOperation({ summary: 'List tenant locations (sites) with server-side search' })
  @ApiResponse(200, 'A page of locations', LocationPageSchema)
  @RequirePermissions('read:User')
  @Get()
  list(@ZQuery(LocationListQuerySchema) query: LocationListQuery) {
    return this.locations.list(query);
  }

  @ApiOperation({ summary: 'Create a location' })
  @ApiResponse(201, 'Created', LocationSchema, {
    location: 'URL of the location',
    etag: 'Current version',
  })
  @RequirePermissions('manage:Tenant')
  @Idempotent()
  @HttpCode(201)
  @Post()
  async create(
    @ZBody(CreateLocationSchema) body: CreateLocationInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LocationDto> {
    const location = await this.locations.create(body);
    setEtag(reply, location.version);
    void reply.header('location', `/v1/locations/${location.id}`);
    return location;
  }

  @ApiOperation({ summary: 'Rename a location (optimistic locking; code is immutable)' })
  @ApiResponse(200, 'Updated', LocationSchema, { etag: 'New version' })
  @RequirePermissions('manage:Tenant')
  @RequiresIfMatch()
  @Patch(':id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateLocationSchema) body: UpdateLocationInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LocationDto> {
    const location = await this.locations.update(id, expectedVersion(request), body);
    setEtag(reply, location.version);
    return location;
  }

  @ApiOperation({ summary: 'Delete a location (soft delete)' })
  @ApiResponse(204, 'Deleted')
  @RequirePermissions('manage:Tenant')
  @RequiresIfMatch()
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.locations.remove(id, expectedVersion(request));
  }
}
