import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { PROBLEM_CONTENT_TYPE, problemForCode } from '@verbis/shared-types';

import { allControllers } from '../app.module.js';
import { TenantDb } from '../infra/database/tenant-db.js';
import { AbilityFactory } from '../modules/authz/ability.factory.js';

import { buildOpenApiDocument } from './generator.js';

import type { ApiEnv } from '../env.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const API_DOCS_PREFIX = '/api/docs';

export function openApiDocument(version: string): Record<string, unknown> {
  return buildOpenApiDocument(allControllers(), {
    title: 'Verbis API',
    version,
    description:
      'Core API of the Verbis agent scripting platform. Errors are RFC 7807 problem+json.',
  });
}

/**
 * Serves the OpenAPI 3.1 document and Swagger UI at /api/docs.
 * `public` (development only) or `admin` (principal with read:ApiDocs or manage:all).
 */
export async function registerApiDocs(app: NestFastifyApplication, env: ApiEnv): Promise<void> {
  if (env.API_DOCS === 'off') return;
  const document = openApiDocument(env.APP_VERSION);
  await app.register(swagger, { mode: 'static', specification: { document: document as never } });

  const deny = (
    request: FastifyRequest,
    reply: FastifyReply,
    code: 'VERBIS_AUTH_UNAUTHENTICATED' | 'VERBIS_AUTHZ_FORBIDDEN',
  ) =>
    reply
      .status(code === 'VERBIS_AUTH_UNAUTHENTICATED' ? 401 : 403)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send(problemForCode(code, { instance: API_DOCS_PREFIX, correlationId: request.id }));

  await app.register(swaggerUi, {
    routePrefix: API_DOCS_PREFIX,
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: false },
    uiHooks: {
      onRequest: (request, reply, done) => {
        if (env.API_DOCS === 'public') {
          done();
          return;
        }
        const principal = request.principal;
        if (principal === undefined) {
          void deny(request, reply, 'VERBIS_AUTH_UNAUTHENTICATED');
          return;
        }
        const resolved = app.get(TenantDb).run(principal.tenantId, async (tx) => {
          const tenant = await tx.tenant.findFirst({
            where: { id: principal.tenantId, status: 'active', deletedAt: null },
            select: { settings: true },
          });
          if (tenant === null) return undefined;
          return app.get(AbilityFactory).forPrincipal(tx, principal, tenant.settings);
        });
        resolved.then(
          (authz) => {
            if (authz?.ability.can('read', 'ApiDocs') === true) done();
            else void deny(request, reply, 'VERBIS_AUTHZ_FORBIDDEN');
          },
          () => {
            void deny(request, reply, 'VERBIS_AUTHZ_FORBIDDEN');
          },
        );
      },
    },
  });
}
