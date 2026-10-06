import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseFilters,
} from '@nestjs/common';
import { z } from 'zod';

import { ZBody, ZParam, ZQuery } from '../../../common/validation/zod.js';
import { OwnTenantTransactions } from '../../../infra/database/tenant-transaction.interceptor.js';
import { ApiOperation, ApiProtocol, ApiResponse, ApiTag } from '../../../openapi/metadata.js';
import { SkipAudit } from '../../audit/audit.decorators.js';
import { RequirePermissions } from '../../authz/permissions.js';

import {
  ScimBulkService,
  ScimBulkRequestSchema,
  SCIM_BULK_MAX_OPERATIONS,
  SCIM_BULK_MAX_PAYLOAD,
} from './scim-bulk.js';
import { PatchRequestSchema, type PatchRequest } from './scim-patch.js';
import { SCIM_CONTENT_TYPE } from './scim.errors.js';
import { ScimExceptionFilter } from './scim.filter.js';
import {
  ENTERPRISE_USER_SCHEMA,
  GROUP_SCHEMA,
  ScimGroupInputSchema,
  ScimUserInputSchema,
  USER_SCHEMA,
  type ScimGroupInput,
  type ScimUserInput,
} from './scim.resources.js';
import { ScimService, type ListParams } from './scim.service.js';

import type { FastifyReply } from 'fastify';

export const SCIM_MAX_RESULTS = 200;

const ListQuerySchema = z.looseObject({
  filter: z.string().max(1000).optional(),
  startIndex: z.coerce.number().int().min(1).max(1_000_000).default(1),
  count: z.coerce
    .number()
    .int()
    .min(0)
    .default(100)
    .transform((value) => Math.min(value, SCIM_MAX_RESULTS)),
  excludedAttributes: z.string().max(256).optional(),
  attributes: z.string().max(512).optional(),
});
type ListQuery = z.output<typeof ListQuerySchema>;

const IdSchema = z.string().min(1).max(64);
const ScimResourceSchema = z
  .looseObject({ schemas: z.array(z.string()) })
  .meta({ id: 'ScimResource' });
const SCIM = {
  errorFormat: 'scim',
  security: ['scimBearer'],
  mediaType: 'application/scim+json',
} as const;

const toParams = (query: ListQuery): ListParams => ({
  startIndex: query.startIndex,
  count: query.count,
  ...(query.filter === undefined ? {} : { filter: query.filter }),
  ...(query.excludedAttributes === undefined
    ? {}
    : { excludedAttributes: query.excludedAttributes }),
});

/** SCIM 2.0 service provider (RFC 7644) at `/scim/v2/<tenant-slug>`; one bearer token per IdP. */
@ApiTag('scim')
@UseFilters(ScimExceptionFilter)
@Controller('scim/v2/:tenant')
export class ScimController {
  constructor(
    @Inject(ScimService) private readonly scim: ScimService,
    @Inject(ScimBulkService) private readonly bulkService: ScimBulkService,
  ) {}

  @Post('Bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process bounded SCIM bulk operations with partial failure results' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'BulkResponse', ScimResourceSchema)
  @RequirePermissions('manage:User', 'manage:Group')
  @OwnTenantTransactions()
  @SkipAudit()
  bulk(
    @Param('tenant') tenant: string,
    @ZBody(ScimBulkRequestSchema) body: z.infer<typeof ScimBulkRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.bulkService.execute(tenant, body);
  }

  @ApiOperation({ summary: 'SCIM service provider configuration' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'ServiceProviderConfig', ScimResourceSchema)
  @RequirePermissions('read:User')
  @Get('ServiceProviderConfig')
  config(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: {
        supported: true,
        maxOperations: SCIM_BULK_MAX_OPERATIONS,
        maxPayloadSize: SCIM_BULK_MAX_PAYLOAD,
      },
      filter: { supported: true, maxResults: SCIM_MAX_RESULTS },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer token',
          description: 'Per-IdP SCIM token issued in Verbis admin',
          primary: true,
        },
      ],
      meta: { resourceType: 'ServiceProviderConfig' },
    };
  }

  @ApiOperation({ summary: 'SCIM resource types' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'ListResponse', ScimResourceSchema)
  @RequirePermissions('read:User')
  @Get('ResourceTypes')
  resourceTypes(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    const types = [
      {
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: USER_SCHEMA,
        schemaExtensions: [{ schema: ENTERPRISE_USER_SCHEMA, required: false }],
      },
      { id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP_SCHEMA },
    ].map((type) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], ...type }));
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: types.length,
      Resources: types,
    };
  }

  @ApiOperation({ summary: 'List or filter users (RFC 7644 §3.4.2)' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'ListResponse', ScimResourceSchema)
  @RequirePermissions('manage:User')
  @Get('Users')
  listUsers(
    @Param('tenant') tenant: string,
    @ZQuery(ListQuerySchema) query: ListQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.listUsers(tenant, toParams(query));
  }

  @ApiOperation({ summary: 'Get a user' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'User', ScimResourceSchema)
  @RequirePermissions('manage:User')
  @Get('Users/:id')
  getUser(
    @Param('tenant') tenant: string,
    @ZParam('id', IdSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.getUser(tenant, id);
  }

  @ApiOperation({ summary: 'Provision a user' })
  @ApiProtocol(SCIM)
  @ApiResponse(201, 'User', ScimResourceSchema)
  @RequirePermissions('manage:User')
  @HttpCode(201)
  @Post('Users')
  async createUser(
    @Param('tenant') tenant: string,
    @ZBody(ScimUserInputSchema) body: ScimUserInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.scim.createUser(tenant, body);
    void reply
      .header('content-type', SCIM_CONTENT_TYPE)
      .header('location', (user['meta'] as { location: string }).location);
    return user;
  }

  @ApiOperation({ summary: 'Replace a user' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'User', ScimResourceSchema)
  @RequirePermissions('manage:User')
  @Put('Users/:id')
  replaceUser(
    @Param('tenant') tenant: string,
    @ZParam('id', IdSchema) id: string,
    @ZBody(ScimUserInputSchema) body: ScimUserInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.replaceUser(tenant, id, body);
  }

  @ApiOperation({ summary: 'Patch a user (active=false revokes sessions)' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'User', ScimResourceSchema)
  @RequirePermissions('manage:User')
  @Patch('Users/:id')
  patchUser(
    @Param('tenant') tenant: string,
    @ZParam('id', IdSchema) id: string,
    @ZBody(PatchRequestSchema) body: PatchRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.patchUser(tenant, id, body);
  }

  @ApiOperation({ summary: 'Deprovision a user (revokes sessions)' })
  @ApiProtocol(SCIM)
  @ApiResponse(204, 'Deprovisioned')
  @RequirePermissions('manage:User')
  @HttpCode(204)
  @Delete('Users/:id')
  async deleteUser(@ZParam('id', IdSchema) id: string): Promise<void> {
    await this.scim.deleteUser(id);
  }

  @ApiOperation({ summary: 'List or filter groups' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'ListResponse', ScimResourceSchema)
  @RequirePermissions('manage:Group')
  @Get('Groups')
  listGroups(
    @Param('tenant') tenant: string,
    @ZQuery(ListQuerySchema) query: ListQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.listGroups(tenant, toParams(query));
  }

  @ApiOperation({ summary: 'Get a group' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'Group', ScimResourceSchema)
  @RequirePermissions('manage:Group')
  @Get('Groups/:id')
  getGroup(
    @Param('tenant') tenant: string,
    @ZParam('id', IdSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.getGroup(tenant, id);
  }

  @ApiOperation({ summary: 'Create a group' })
  @ApiProtocol(SCIM)
  @ApiResponse(201, 'Group', ScimResourceSchema)
  @RequirePermissions('manage:Group')
  @HttpCode(201)
  @Post('Groups')
  async createGroup(
    @Param('tenant') tenant: string,
    @ZBody(ScimGroupInputSchema) body: ScimGroupInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const group = await this.scim.createGroup(tenant, body);
    void reply
      .header('content-type', SCIM_CONTENT_TYPE)
      .header('location', (group['meta'] as { location: string }).location);
    return group;
  }

  @ApiOperation({ summary: 'Replace a group' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'Group', ScimResourceSchema)
  @RequirePermissions('manage:Group')
  @Put('Groups/:id')
  replaceGroup(
    @Param('tenant') tenant: string,
    @ZParam('id', IdSchema) id: string,
    @ZBody(ScimGroupInputSchema) body: ScimGroupInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.replaceGroup(tenant, id, body);
  }

  @ApiOperation({ summary: 'Patch a group (members add/remove/replace)' })
  @ApiProtocol(SCIM)
  @ApiResponse(200, 'Group', ScimResourceSchema)
  @RequirePermissions('manage:Group')
  @Patch('Groups/:id')
  patchGroup(
    @Param('tenant') tenant: string,
    @ZParam('id', IdSchema) id: string,
    @ZBody(PatchRequestSchema) body: PatchRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('content-type', SCIM_CONTENT_TYPE);
    return this.scim.patchGroup(tenant, id, body);
  }

  @ApiOperation({ summary: 'Delete a group' })
  @ApiProtocol(SCIM)
  @ApiResponse(204, 'Deleted')
  @RequirePermissions('manage:Group')
  @HttpCode(204)
  @Delete('Groups/:id')
  async deleteGroup(@ZParam('id', IdSchema) id: string): Promise<void> {
    await this.scim.deleteGroup(id);
  }
}
