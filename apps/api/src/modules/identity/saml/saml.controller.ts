import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../../../common/security/public.decorator.js';
import { ZParam } from '../../../common/validation/zod.js';
import { ApiOperation, ApiProtocol, ApiResponse, ApiTag } from '../../../openapi/metadata.js';
import { BrowserResponder } from '../login/browser-responder.js';
import { LoginFlowService } from '../login/login-flow.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const PROTOCOL = { errorFormat: 'redirect', security: [] } as const;

const stringRecord = (value: unknown): Record<string, string> =>
  value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

/** SAML 2.0 SP endpoints per tenant IdP: metadata, ACS (HTTP-POST), SLO (Redirect/POST). */
@ApiTag('auth')
@Controller('auth/saml/:tenant/:idp')
export class SamlController {
  constructor(
    @Inject(LoginFlowService) private readonly flows: LoginFlowService,
    @Inject(BrowserResponder) private readonly browser: BrowserResponder,
  ) {}

  @ApiOperation({ summary: 'SAML SP metadata (active and next certificates)' })
  @ApiProtocol({ ...PROTOCOL, mediaType: 'application/samlmetadata+xml' })
  @ApiResponse(200, 'SP metadata XML')
  @Public()
  @Get('metadata')
  async metadata(
    @ZParam('tenant', Slug) tenant: string,
    @ZParam('idp', z.uuid()) idp: string,
    @Res() reply: FastifyReply,
  ) {
    const xml = await this.flows.spMetadata(tenant, idp);
    void reply
      .header('content-type', 'application/samlmetadata+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(xml);
  }

  @ApiOperation({ summary: 'Assertion Consumer Service (HTTP-POST binding)' })
  @ApiProtocol({ ...PROTOCOL, mediaType: 'application/x-www-form-urlencoded' })
  @ApiResponse(302, 'Redirect to the app')
  @Public()
  @HttpCode(302)
  @Post('acs')
  async acs(
    @ZParam('tenant', Slug) tenant: string,
    @ZParam('idp', z.uuid()) idp: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const outcome = await this.flows.samlAcs(
      tenant,
      idp,
      stringRecord(body),
      this.browser.context(request),
    );
    this.browser.complete(reply, outcome);
  }

  @ApiOperation({ summary: 'Single Logout (HTTP-Redirect binding)' })
  @ApiProtocol(PROTOCOL)
  @ApiResponse(302, 'Redirect')
  @Public()
  @Get('slo')
  async sloRedirect(
    @ZParam('tenant', Slug) tenant: string,
    @ZParam('idp', z.uuid()) idp: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const index = request.url.indexOf('?');
    const url = await this.flows.samlSlo(tenant, idp, {
      method: 'GET',
      query: stringRecord(request.query),
      rawQuery: index < 0 ? '' : request.url.slice(index + 1),
    });
    void reply.header('cache-control', 'no-store').redirect(url, 302);
  }

  @ApiOperation({ summary: 'Single Logout (HTTP-POST binding)' })
  @ApiProtocol({ ...PROTOCOL, mediaType: 'application/x-www-form-urlencoded' })
  @ApiResponse(302, 'Redirect')
  @Public()
  @HttpCode(302)
  @Post('slo')
  async sloPost(
    @ZParam('tenant', Slug) tenant: string,
    @ZParam('idp', z.uuid()) idp: string,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ) {
    const url = await this.flows.samlSlo(tenant, idp, { method: 'POST', body: stringRecord(body) });
    void reply.header('cache-control', 'no-store').redirect(url, 302);
  }
}
