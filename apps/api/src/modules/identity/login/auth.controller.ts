import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { DomainError, UnauthenticatedError } from '../../../common/errors/domain-errors.js';
import { Public } from '../../../common/security/public.decorator.js';
import { ZBody, ZQuery } from '../../../common/validation/zod.js';
import { ApiOperation, ApiProtocol, ApiResponse, ApiTag } from '../../../openapi/metadata.js';
import { AnyAuthenticated } from '../../authz/permissions.js';
import { randomToken } from '../crypto/random.js';
import { OidcLoginError } from '../oidc/oidc.service.js';
import { summarize } from '../session/session.types.js';

import { BrowserResponder } from './browser-responder.js';
import { LoginFlowService } from './login-flow.service.js';
import { LOGIN_TRANSACTION_TTL_SECONDS } from './login-transaction.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const DiscoverRequestSchema = z
  .strictObject({ email: z.email().max(320).optional(), tenant: Slug.optional() })
  .refine(
    (value) => (value.email === undefined) !== (value.tenant === undefined),
    'send exactly one of email or tenant',
  )
  .meta({ id: 'DiscoverRequest' });
export const DiscoverResponseSchema = z
  .object({
    tenant: z.string(),
    providers: z.array(
      z.object({ id: z.uuid(), displayName: z.string(), protocol: z.enum(['oidc', 'saml']) }),
    ),
  })
  .meta({ id: 'DiscoverResponse' });

const LoginQuerySchema = z.strictObject({
  tenant: Slug.optional(),
  idp: z.uuid().optional(),
  app: z.string().regex(/^[a-z]{1,32}$/),
  returnTo: z.string().max(512).optional(),
});
type LoginQuery = z.output<typeof LoginQuerySchema>;

const CallbackQuerySchema = z.looseObject({
  state: z.string().max(128).optional(),
  code: z.string().max(4096).optional(),
  error: z.string().max(256).optional(),
  iss: z.string().max(2048).optional(),
});

export const AuthSessionSchema = z
  .object({
    user: z.object({
      id: z.uuid(),
      tenantId: z.uuid(),
      authMethod: z.enum(['sso', 'break_glass']),
    }),
    session: z.object({
      id: z.uuid(),
      kind: z.enum(['sso', 'break_glass']),
      protocol: z.enum(['oidc', 'saml', 'local']),
      idpId: z.uuid().nullable(),
      app: z.string(),
      createdAt: z.string(),
      lastSeenAt: z.string(),
      expiresAt: z.string(),
      ip: z.string(),
      userAgent: z.string(),
    }),
    csrfToken: z.string(),
  })
  .meta({ id: 'AuthSession' });

/** Same as `AuthSession`, but a signed-out browser gets 200 instead of a console-noisy 401 (U-01). */
export const AuthSessionStatusSchema = z
  .union([
    z.object({ authenticated: z.literal(false) }),
    AuthSessionSchema.extend({ authenticated: z.literal(true) }),
  ])
  .meta({ id: 'AuthSessionStatus' });

export const LogoutResponseSchema = z
  .object({ redirectUrl: z.string() })
  .meta({ id: 'LogoutResponse' });

const REDIRECT = { errorFormat: 'redirect', security: [] } as const;

const rawQuery = (request: FastifyRequest) => {
  const index = request.url.indexOf('?');
  return index < 0 ? '' : request.url.slice(index + 1);
};

/**
 * Browser-facing BFF endpoints (ADR-0004/0012). Responses never contain IdP tokens; the session
 * is an httpOnly cookie, and `GET /auth/session` hands the SPA its CSRF token.
 */
@ApiTag('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(LoginFlowService) private readonly flows: LoginFlowService,
    @Inject(BrowserResponder) private readonly browser: BrowserResponder,
  ) {}

  @ApiOperation({ summary: 'Home-realm discovery by email domain or tenant slug' })
  @ApiResponse(200, 'Providers to sign in with', DiscoverResponseSchema)
  @Public()
  @HttpCode(200)
  @Post('discover')
  async discover(@ZBody(DiscoverRequestSchema) body: z.output<typeof DiscoverRequestSchema>) {
    const result = await this.flows.discover({
      ...(body.email === undefined ? {} : { email: body.email }),
      ...(body.tenant === undefined ? {} : { tenant: body.tenant }),
    });
    if (result === undefined || result.providers.length === 0)
      throw new DomainError('VERBIS_AUTH_TENANT_UNKNOWN');
    return result;
  }

  @ApiOperation({
    summary:
      'Start SSO: redirects to the identity provider (Authorization Code + PKCE or SAML AuthnRequest)',
  })
  @ApiProtocol(REDIRECT)
  @ApiResponse(302, 'Redirect to the IdP')
  @Public()
  @Get('login')
  async login(
    @ZQuery(LoginQuerySchema) query: LoginQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const host = request.headers.host;
    const tenant =
      query.tenant ??
      this.flows.tenantFromHost(host, request.protocol === 'https' ? 'https' : 'http');
    if (tenant === undefined) throw new DomainError('VERBIS_AUTH_TENANT_UNKNOWN');
    const handle = randomToken(32);
    const url = await this.flows.start({
      tenant,
      ...(query.idp === undefined ? {} : { idpId: query.idp }),
      app: query.app,
      ...(query.returnTo === undefined ? {} : { returnTo: query.returnTo }),
      transactionCookie: handle,
    });
    this.browser.cookie.setTransaction(reply, handle, LOGIN_TRANSACTION_TTL_SECONDS);
    void reply.header('cache-control', 'no-store').redirect(url, 302);
  }

  @ApiOperation({ summary: 'OIDC redirect URI (authorization response)' })
  @ApiProtocol(REDIRECT)
  @ApiResponse(302, 'Redirect to the app')
  @Public()
  @Get('oidc/callback')
  async oidcCallback(
    @ZQuery(CallbackQuerySchema) query: Record<string, string>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const outcome = await this.flows.oidcCallback(
      query,
      rawQuery(request),
      this.browser.context(request),
    );
    this.browser.complete(reply, outcome);
  }

  @ApiOperation({ summary: 'OIDC Back-Channel Logout 1.0 endpoint (logout_token)' })
  @ApiProtocol({
    errorFormat: 'oauth',
    security: [],
    mediaType: 'application/x-www-form-urlencoded',
  })
  @ApiResponse(200, 'Sessions ended')
  @Public()
  @HttpCode(200)
  @Post('oidc/:tenant/:idp/backchannel-logout')
  async backchannelLogout(
    @Param('tenant') tenant: string,
    @Param('idp') idp: string,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ) {
    void reply.header('cache-control', 'no-store');
    try {
      if (!Slug.safeParse(tenant).success || !z.uuid().safeParse(idp).success)
        throw new OidcLoginError('unknown_idp');
      const token =
        body !== null && typeof body === 'object'
          ? (body as Record<string, unknown>)['logout_token']
          : undefined;
      await this.flows.backchannelLogout(tenant, idp, token);
      void reply.status(200).send();
    } catch (error) {
      if (error instanceof OidcLoginError || error instanceof DomainError) {
        void reply
          .status(400)
          .header('content-type', 'application/json')
          .send({ error: 'invalid_request' });
        return;
      }
      throw error;
    }
  }

  @ApiOperation({ summary: 'OIDC Front-Channel Logout 1.0 endpoint (iss, sid), framed by the IdP' })
  @ApiProtocol(REDIRECT)
  @ApiResponse(200, 'Empty page')
  @Public()
  @Get('oidc/:tenant/:idp/frontchannel-logout')
  async frontchannelLogout(
    @Param('tenant') tenant: string,
    @Param('idp') idp: string,
    @ZQuery(
      z.looseObject({ iss: z.string().max(2048).optional(), sid: z.string().max(512).optional() }),
    )
    query: { iss?: string; sid?: string },
    @Res() reply: FastifyReply,
  ) {
    const idpOrigin =
      Slug.safeParse(tenant).success && z.uuid().safeParse(idp).success
        ? await this.flows
            .frontchannelLogout(tenant, idp, query.iss, query.sid)
            .catch(() => undefined)
        : undefined;
    // Only the IdP may frame this page; it carries no content.
    void reply
      .header('cache-control', 'no-store')
      .header(
        'content-security-policy',
        `default-src 'none'; frame-ancestors ${idpOrigin ?? "'none'"}`,
      )
      .header('content-type', 'text/html; charset=utf-8')
      .send('<!doctype html><title>Signed out</title>');
  }

  @ApiOperation({ summary: 'Current BFF session (and its CSRF token)' })
  @ApiResponse(200, 'The session', AuthSessionSchema)
  @ApiResponse(
    429,
    'Too many session checks (RFC 7807, VERBIS_HTTP_RATE_LIMITED). Limited per session cookie plus a shared per-IP cap; clients must not treat this as a signed-out state.',
    undefined,
    {
      'Retry-After': 'Seconds until the current rate-limit window ends',
      'RateLimit-Limit': 'Requests allowed per window for this key',
      'RateLimit-Remaining': 'Requests left in the current window',
    },
  )
  @AnyAuthenticated()
  @Get('session')
  session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const session = request.verbisSession;
    if (session === undefined) throw new UnauthenticatedError();
    void reply.header('cache-control', 'no-store');
    return {
      user: {
        id: session.record.userId,
        tenantId: session.record.tenantId,
        authMethod: session.record.kind,
      },
      session: summarize(session.record),
      csrfToken: session.record.csrfToken,
    };
  }

  @ApiOperation({
    summary: 'Session probe that answers 200 {authenticated:false} when signed out (no 401)',
  })
  @ApiResponse(200, 'Signed-in session or {authenticated:false}', AuthSessionStatusSchema)
  @ApiResponse(
    429,
    'Too many session checks (RFC 7807, VERBIS_HTTP_RATE_LIMITED); shares the /auth/session budget. Clients must not treat this as a signed-out state.',
  )
  @Public()
  @Get('session/status')
  sessionStatus(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('cache-control', 'no-store');
    const session = request.verbisSession;
    if (session === undefined) return { authenticated: false as const };
    return {
      authenticated: true as const,
      user: {
        id: session.record.userId,
        tenantId: session.record.tenantId,
        authMethod: session.record.kind,
      },
      session: summarize(session.record),
      csrfToken: session.record.csrfToken,
    };
  }

  @ApiOperation({
    summary: 'Sign out (RP-initiated logout); returns the IdP logout URL to navigate to',
  })
  @ApiResponse(200, 'Where to go next', LogoutResponseSchema)
  @AnyAuthenticated()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const session = request.verbisSession;
    if (session === undefined) throw new UnauthenticatedError();
    const result = await this.flows.logout(session.hash, session.record);
    this.browser.cookie.clear(reply);
    void reply.header('cache-control', 'no-store').header('clear-site-data', '"cache", "storage"');
    return result;
  }
}
