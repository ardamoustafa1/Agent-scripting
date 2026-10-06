import { Body, Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../../../common/security/public.decorator.js';
import { ApiOperation, ApiProtocol, ApiResponse, ApiTag } from '../../../openapi/metadata.js';
import { IdentityAuthenticator } from '../session/identity-authenticator.js';

import { ClientCredentialsService, OAuthError } from './client-credentials.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

export const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int(),
    scope: z.string(),
  })
  .meta({ id: 'OAuthTokenResponse' });

function basicCredentials(header: string | undefined): { id: string; secret: string } | undefined {
  const value = header === undefined ? undefined : /^Basic ([A-Za-z0-9+/=]+)$/.exec(header)?.[1];
  if (value === undefined) return undefined;
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const index = decoded.indexOf(':');
  if (index < 0) return undefined;
  // RFC 6749 §2.3.1: both parts are form-urlencoded.
  try {
    return {
      id: decodeURIComponent(decoded.slice(0, index)),
      secret: decodeURIComponent(decoded.slice(index + 1)),
    };
  } catch {
    return undefined;
  }
}

/** OAuth 2.0 token endpoint for service clients (`/oauth2/<tenant-slug>/token`). */
@ApiTag('auth')
@Controller('oauth2/:tenant')
export class OAuth2Controller {
  constructor(
    @Inject(ClientCredentialsService) private readonly tokens: ClientCredentialsService,
    @Inject(IdentityAuthenticator) private readonly authenticator: IdentityAuthenticator,
  ) {}

  @ApiOperation({
    summary:
      'Client-credentials grant (client_secret_basic, client_secret_post or tls_client_auth)',
  })
  @ApiProtocol({
    errorFormat: 'oauth',
    security: ['oauthClient'],
    mediaType: 'application/x-www-form-urlencoded',
  })
  @ApiResponse(200, 'Access token (internal JWT, ≤ 5 minutes)', TokenResponseSchema)
  @Public()
  @HttpCode(200)
  @Post('token')
  async token(
    @Param('tenant') tenant: string,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    void reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
    const body = (rawBody !== null && typeof rawBody === 'object' ? rawBody : {}) as Record<
      string,
      unknown
    >;
    const basic = basicCredentials(request.headers.authorization);
    const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
    try {
      if (basic !== undefined && body['client_secret'] !== undefined)
        throw new OAuthError('invalid_request', 400, 'one client authentication method only');
      const thumbprint = this.authenticator.clientCertificateThumbprint(request);
      const clientId = basic?.id ?? str(body['client_id']);
      const secret = basic?.secret ?? str(body['client_secret']);
      const response = await this.tokens.issue({
        tenant,
        grantType: body['grant_type'],
        scope: body['scope'],
        ...(clientId === undefined ? {} : { clientId }),
        ...(secret === undefined ? {} : { clientSecret: secret }),
        secretVia:
          basic !== undefined ? 'basic' : body['client_secret'] !== undefined ? 'post' : 'none',
        ...(thumbprint === undefined ? {} : { certificateThumbprint: thumbprint }),
      });
      void reply.status(200).send(response);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (error.status === 401 && basic !== undefined)
        void reply.header('www-authenticate', 'Basic realm="verbis"');
      void reply
        .status(error.status)
        .header('content-type', 'application/json')
        .send({
          error: error.error,
          ...(error.description === undefined ? {} : { error_description: error.description }),
        });
    }
  }
}
