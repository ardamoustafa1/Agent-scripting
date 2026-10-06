import { Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { AttachedDataMapSchema } from '@verbis/sdk-connector';

import { UuidSchema } from '../../../common/dto.js';
import { expectedVersion, setEtag } from '../../../common/http/if-match.js';
import { ZBody, ZParam, ZQuery } from '../../../common/validation/zod.js';
import {
  ApiOperation,
  ApiProtocol,
  ApiResponse,
  ApiTag,
  RequiresIfMatch,
} from '../../../openapi/metadata.js';
import { SkipAudit } from '../../audit/audit.decorators.js';
import { RequirePermissions } from '../../authz/permissions.js';

import { AttachedDataMapService } from './attached-data-map.service.js';
import { EngageLinkError } from './engage-agent-link.js';
import { EngageAgentLinkService } from './engage-agent-link.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const DONE = '/genesys/linked';
const REDIRECT = { errorFormat: 'redirect', security: [] } as const;
const CallbackQuerySchema = z.object({
  code: z.string().min(1).max(4_096).optional(),
  state: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
  error: z.string().max(128).optional(),
});
const LinkStatusSchema = z
  .array(
    z.object({ connectorId: UuidSchema, linked: z.boolean(), expiresAt: z.string().nullable() }),
  )
  .meta({ id: 'EngageLinkStatus' });
const AttachedDataMapBodySchema = z
  .strictObject({ attachedData: AttachedDataMapSchema })
  .meta({ id: 'EngageAttachedDataMap' });
const AttachedDataMapResponseSchema = z.object({
  connectorId: UuidSchema,
  version: z.number().int(),
  attachedData: AttachedDataMapSchema,
});

/** Agent (BFF session): delegated Genesys Engage link in a first-party popup (ADR-0019). */
@ApiTag('connectors')
@Controller('v1/genesys-engage')
export class GenesysEngageAgentController {
  constructor(@Inject(EngageAgentLinkService) private readonly links: EngageAgentLinkService) {}

  @ApiOperation({ summary: 'Agent: Genesys Engage link status per workspace connector' })
  @ApiResponse(200, 'Link status', LinkStatusSchema)
  @RequirePermissions('create:Session')
  @Get('links')
  status() {
    return this.links.status();
  }

  @ApiOperation({ summary: 'Agent: start the Genesys Authentication link (Authorization Code)' })
  @ApiProtocol(REDIRECT)
  @ApiResponse(302, 'Redirect to Genesys Authentication')
  @RequirePermissions('create:Session')
  @SkipAudit()
  @Get('connectors/:id/oauth/authorize')
  async authorize(@ZParam('id', UuidSchema) id: string, @Res() reply: FastifyReply) {
    try {
      const url = await this.links.start(id);
      void reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .redirect(url, 302);
    } catch (error) {
      if (!(error instanceof EngageLinkError)) throw error;
      void reply.header('cache-control', 'no-store').redirect(`${DONE}#status=failed`, 302);
    }
  }

  @ApiOperation({
    summary: 'Agent: Genesys Authentication redirect URI (links the agent, closes the popup)',
  })
  @ApiProtocol(REDIRECT)
  @ApiResponse(302, 'Redirect to agent-web')
  @RequirePermissions('create:Session')
  @SkipAudit()
  @Get('oauth/callback')
  async callback(
    @ZQuery(CallbackQuerySchema) query: z.infer<typeof CallbackQuerySchema>,
    @Res() reply: FastifyReply,
  ) {
    let status = 'failed';
    if (query.code !== undefined && query.state !== undefined && query.error === undefined) {
      try {
        await this.links.complete(query.code, query.state);
        status = 'linked';
      } catch (error) {
        if (!(error instanceof EngageLinkError)) throw error;
      }
    }
    void reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .redirect(`${DONE}#status=${status}`, 302);
  }

  @ApiOperation({ summary: 'Agent: drop the delegated Genesys Engage link (end of shift)' })
  @ApiResponse(204, 'Unlinked')
  @RequirePermissions('create:Session')
  @SkipAudit()
  @HttpCode(204)
  @Post('connectors/:id/unlink')
  async unlink(@ZParam('id', UuidSchema) id: string) {
    await this.links.unlink(id);
  }
}

/** connector-hub (mTLS) → API: linked agents and their short-lived access tokens. */
@ApiTag('connector-hub')
@Controller('v1/connector-hub/connectors/:id/engage')
export class GenesysEngageHubController {
  constructor(@Inject(EngageAgentLinkService) private readonly links: EngageAgentLinkService) {}

  @ApiOperation({ summary: 'Hub: agents with a live delegated Genesys Engage link' })
  @ApiResponse(200, 'Agents', z.object({ agents: z.array(z.string()) }))
  @RequirePermissions('read:Connector')
  @Get('agents')
  agents(@ZParam('id', UuidSchema) id: string) {
    return this.links.linkedAgents(id);
  }

  @ApiOperation({ summary: 'Hub: short-lived Workspace API token for one linked agent' })
  @ApiResponse(200, 'Token', z.object({ accessToken: z.string(), expiresAt: z.string() }))
  @RequirePermissions('read:Connector')
  @SkipAudit()
  @HttpCode(200)
  @Post('agent-token')
  token(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(z.strictObject({ platformUserId: z.string().min(1).max(256) }))
    body: { platformUserId: string },
  ) {
    return this.links.agentToken(id, body.platformUserId);
  }
}

/** Admin: attached data → script variable mapping of a Genesys Engage connector. */
@ApiTag('connectors')
@Controller('v1/connectors/:id/attached-data-map')
export class AttachedDataMapController {
  constructor(@Inject(AttachedDataMapService) private readonly maps: AttachedDataMapService) {}

  @ApiOperation({ summary: 'Get the attached data → variable mapping' })
  @ApiResponse(200, 'Mapping', AttachedDataMapResponseSchema, { etag: 'Connector version' })
  @RequirePermissions('read:Connector')
  @Get()
  async get(@ZParam('id', UuidSchema) id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.maps.get(id);
    setEtag(reply, result.version);
    return result;
  }

  @ApiOperation({ summary: 'Replace the attached data → variable mapping (optimistic locking)' })
  @ApiResponse(200, 'Mapping', AttachedDataMapResponseSchema, { etag: 'New connector version' })
  @RequirePermissions('update:Connector')
  @RequiresIfMatch()
  @SkipAudit()
  @Put()
  async put(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(AttachedDataMapBodySchema) body: z.infer<typeof AttachedDataMapBodySchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.maps.replace(id, expectedVersion(request), body.attachedData);
    setEtag(reply, result.version);
    return result;
  }
}
