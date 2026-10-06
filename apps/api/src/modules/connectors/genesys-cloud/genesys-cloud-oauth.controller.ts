import { Controller, Get, Inject, Res } from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../../common/dto.js';
import { ZParam, ZQuery } from '../../../common/validation/zod.js';
import { ApiOperation, ApiProtocol, ApiResponse, ApiTag } from '../../../openapi/metadata.js';
import { SkipAudit } from '../../audit/audit.decorators.js';
import { RequirePermissions } from '../../authz/permissions.js';

import { GenesysLinkError } from './genesys-user-link.js';
import { GenesysUserLinkService } from './genesys-user-link.service.js';

import type { FastifyReply } from 'fastify';

const CallbackQuerySchema = z.object({
  code: z.string().min(1).max(2_048).optional(),
  state: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
  error: z.string().max(128).optional(),
});

/** agent-web page that closes the popup and tells the widget to retry the embedded launch. */
const DONE = '/genesys/linked';
const REDIRECT = { errorFormat: 'redirect', security: [] } as const;

/**
 * Genesys Cloud user link (Authorization Code + PKCE through the BFF). Both endpoints run in a
 * first-party popup on the agent-web origin (the widget iframe's cookies may be partitioned), so
 * they rely on the normal BFF session cookie. Outcomes are audited by the service.
 */
@ApiTag('connectors')
@Controller('v1/genesys-cloud')
export class GenesysCloudOAuthController {
  constructor(@Inject(GenesysUserLinkService) private readonly links: GenesysUserLinkService) {}

  @ApiOperation({
    summary: 'Start linking the Genesys Cloud user (redirects to login.<region>, PKCE S256)',
  })
  @ApiProtocol(REDIRECT)
  @ApiResponse(302, 'Redirect to Genesys Cloud login')
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
      if (!(error instanceof GenesysLinkError)) throw error;
      void reply.header('cache-control', 'no-store').redirect(`${DONE}#status=failed`, 302);
    }
  }

  @ApiOperation({
    summary:
      'Genesys Cloud OAuth redirect URI: exchanges the code, links the user, closes the popup',
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
        if (!(error instanceof GenesysLinkError)) throw error;
      }
    }
    // Same-origin relative redirect; no reason in the URL (no oracle), the audit log has it.
    void reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .redirect(`${DONE}#status=${status}`, 302);
  }
}
