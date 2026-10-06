import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';

import { UuidSchema } from '../../common/dto.js';
import { expectedVersion, setEtag } from '../../common/http/if-match.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  Idempotent,
  RequiresIfMatch,
} from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  CampaignListQuerySchema,
  CampaignPageSchema,
  CampaignSchema,
  CreateCampaignSchema,
  UpdateCampaignSchema,
  type CampaignDto,
  type CampaignListQuery,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from './campaigns.dto.js';
import { CampaignsService } from './campaigns.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTag('campaigns')
@Controller('v1/campaigns')
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @ApiOperation({ summary: 'List campaigns (cursor pagination)' })
  @ApiResponse(200, 'A page of campaigns', CampaignPageSchema)
  @RequirePermissions('read:Campaign')
  @Get()
  list(@ZQuery(CampaignListQuerySchema) query: CampaignListQuery) {
    return this.campaigns.list(query);
  }

  @ApiOperation({ summary: 'Get a campaign' })
  @ApiResponse(200, 'The campaign', CampaignSchema, { etag: 'Current version' })
  @RequirePermissions('read:Campaign')
  @Get(':id')
  async get(
    @ZParam('id', UuidSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.get(id);
    setEtag(reply, campaign.version);
    return campaign;
  }

  @ApiOperation({ summary: 'Create a campaign' })
  @ApiResponse(201, 'Created', CampaignSchema, {
    location: 'URL of the campaign',
    etag: 'Current version',
  })
  @RequirePermissions('create:Campaign')
  @Idempotent()
  @HttpCode(201)
  @Post()
  async create(
    @ZBody(CreateCampaignSchema) body: CreateCampaignInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.create(body);
    setEtag(reply, campaign.version);
    void reply.header('location', `/v1/campaigns/${campaign.id}`);
    return campaign;
  }

  @ApiOperation({ summary: 'Update a campaign (optimistic locking)' })
  @ApiResponse(200, 'Updated', CampaignSchema, { etag: 'New version' })
  @RequirePermissions('update:Campaign')
  @RequiresIfMatch()
  @Patch(':id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateCampaignSchema) body: UpdateCampaignInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.update(id, expectedVersion(request), body);
    setEtag(reply, campaign.version);
    return campaign;
  }

  @ApiOperation({ summary: 'Delete a campaign (soft delete)' })
  @ApiResponse(204, 'Deleted')
  @RequirePermissions('delete:Campaign')
  @RequiresIfMatch()
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.campaigns.remove(id, expectedVersion(request));
  }
}
