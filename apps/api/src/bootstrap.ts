import 'reflect-metadata';

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { instruments, registerHttpMetrics } from '@verbis/observability';

import { AppModule } from './app.module.js';
import { registerContextHook } from './common/context/context.hook.js';
import { registerCors, TenantOriginPolicy, type OriginPolicy } from './common/http/cors.js';
import { registerJsonSecurity } from './common/http/json-security.js';
import { registerRateLimit } from './common/http/rate-limit.js';
import { createLogger, PinoNestLogger } from './common/logging/logger.js';
import {
  registerAuthenticationHook,
  type RequestAuthenticator,
} from './common/security/auth.hook.js';
import { PrincipalVerifier } from './common/security/principal.js';
import { createFastifyAdapterOptions } from './fastify-options.js';
import { PrismaService } from './infra/database/prisma.service.js';
import { RedisService } from './infra/redis/redis.service.js';
import { IdentityAuthenticator } from './modules/identity/session/identity-authenticator.js';
import { registerApiDocs } from './openapi/docs.js';

import type { ApiEnv } from './env.js';
import type { Logger as PinoLogger } from 'pino';

/** Routes that accept larger bodies than the 1 MiB default (script documents up to 2 MB). */
const LARGE_BODY_ROUTES = new Set(['POST /v1/scripts/:id/versions']);
const LARGE_BODY_LIMIT = 4 * 1024 * 1024;

export interface CreateAppOptions {
  readonly logger?: PinoLogger;
  /** Overrides the CORS origin policy (tests). */
  readonly originPolicy?: OriginPolicy;
  /** Use the in-memory rate-limit store instead of Redis (unit tests). */
  readonly inMemoryRateLimit?: boolean;
  /** Adjusts the Nest module before creation (tests replace infrastructure providers). */
  readonly configure?: (module: ReturnType<typeof AppModule.forRoot>) => void;
}

/** Builds the fully configured application (used by main.ts and every HTTP-level test). */
export async function createApp(
  env: ApiEnv,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = options.logger ?? createLogger(env.LOG_LEVEL);
  const adapter = new FastifyAdapter(createFastifyAdapterOptions(logger, env.TRUSTED_PROXIES));
  const fastify = adapter.getInstance();
  registerHttpMetrics(fastify);
  // Session cookies and SCIM tokens are resolved by the identity module once the app exists.
  const identityAuth: { current?: RequestAuthenticator } = {};

  // Hook order = execution order: context → authentication → (plugins: CORS, rate limit).
  registerContextHook(fastify);
  registerAuthenticationHook(
    fastify,
    new PrincipalVerifier({
      jwks: PrincipalVerifier.parseJwks(env.INTERNAL_JWT_JWKS),
      issuer: env.INTERNAL_JWT_ISSUER,
      audience: env.INTERNAL_JWT_AUDIENCE,
    }),
    () => identityAuth.current,
  );
  fastify.addHook('onRoute', (route) => {
    if (route.url === '/v1/ai/suggestions') route.bodyLimit = 2_500_000;
    if (route.url === '/v1/security/csp-reports') route.bodyLimit = 16_384;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (methods.some((method) => LARGE_BODY_ROUTES.has(`${method} ${route.url}`)))
      route.bodyLimit = LARGE_BODY_LIMIT;
  });
  // SCIM clients send application/scim+json (RFC 7644 §3.1).
  fastify.addContentTypeParser(
    /^application\/scim\+json(;.*)?$/,
    { parseAs: 'string', bodyLimit: 1_048_576 },
    (_request, body, done) => {
      try {
        done(null, JSON.parse(body as string) as unknown);
      } catch {
        done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined);
      }
    },
  );
  fastify.addContentTypeParser(
    'application/csp-report',
    { parseAs: 'string', bodyLimit: 16_384 },
    (_request, body, done) => {
      try {
        done(null, JSON.parse(body as string) as unknown);
      } catch {
        done(Object.assign(new Error('Invalid CSP report'), { statusCode: 400 }), undefined);
      }
    },
  );
  // Errors from hooks and parsers reach ProblemDetailsFilter through Nest's own Fastify error handler.

  const module = AppModule.forRoot(env);
  options.configure?.(module);
  const app = await NestFactory.create<NestFastifyApplication>(module, adapter, {
    logger: new PinoNestLogger(logger),
    abortOnError: false,
  });
  identityAuth.current = app.get(IdentityAuthenticator);
  await app.register(cookie);
  // Nest parses application/x-www-form-urlencoded (SAML POST binding, back-channel logout, OAuth
  // token endpoint); cookie-authenticated mutations must still be JSON (CSRF check).
  await app.register(helmet, {
    // JSON API: nothing may be framed or executed; /api/docs sets its own CSP (staticCSP).
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        scriptSrcAttr: ["'none'"],
        objectSrc: ["'none'"],
        requireTrustedTypesFor: ["'script'"],
        trustedTypes: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    // Nothing the API serves may be framed (SECURITY §4.5); agent-web uses /v1/embedding-policy.
    frameguard: { action: 'deny' },
  });
  const prisma = app.get(PrismaService);
  const activeSessions = async (result: { observe(value: number): void }) => {
    try {
      const rows = await prisma.client.$queryRaw<
        { count: bigint }[]
      >`SELECT operational_active_sessions() AS count`;
      if (rows[0]) result.observe(Number(rows[0].count));
    } catch {
      /* Missing migration or DB outage: absent data, never a false zero. */
    }
  };
  instruments.activeSessions.addCallback(activeSessions);
  fastify.addHook('onClose', (_instance, done) => {
    instruments.activeSessions.removeCallback(activeSessions);
    done();
  });
  await registerCors(
    fastify,
    options.originPolicy ??
      new TenantOriginPolicy(env.CORS_ALLOWED_ORIGINS, async (origin) => {
        const rows = await prisma.client.$queryRaw<
          { allowed: boolean }[]
        >`SELECT tenant_origin_allowed(${origin}) AS allowed`;
        return rows[0]?.allowed === true;
      }),
  );
  registerJsonSecurity(fastify);
  await registerRateLimit(fastify, {
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    sessionCookieName: `${env.SESSION_COOKIE_SECURE ? '__Host-' : ''}${env.SESSION_COOKIE_NAME}`,
    authSession: {
      ipMax: env.AUTH_SESSION_RATE_LIMIT_IP_MAX,
      sessionMax: env.AUTH_SESSION_RATE_LIMIT_SESSION_MAX,
      anonymousMax: env.AUTH_SESSION_RATE_LIMIT_ANONYMOUS_MAX,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    },
    ...(options.inMemoryRateLimit === true ? {} : { redis: app.get(RedisService).client }),
  });
  await registerApiDocs(app, env);

  app.enableShutdownHooks();
  return app;
}
