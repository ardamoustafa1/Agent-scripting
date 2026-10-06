import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';

import { type HubEnv, HUB_ENV } from '../env.js';

import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    hubTenantId?: string;
  }
}

export const HUB_AUDIENCE = 'verbis-connector-hub';
export const HUB_ISSUER = 'verbis-api';

const Claims = z.object({ tnt: z.uuid(), typ: z.literal('service'), sub: z.literal('verbis-api') });

/**
 * API → hub calls: EdDSA token from the API (≤ 60 s, audience verbis-connector-hub). The tenant
 * comes only from the verified `tnt` claim and scopes every connector lookup.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  readonly #keys: ReturnType<typeof createLocalJWKSet>;

  constructor(@Inject(HUB_ENV) env: HubEnv) {
    this.#keys = createLocalJWKSet(JSON.parse(env.HUB_TRUSTED_JWKS) as JSONWebKeySet);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.authorization ?? '');
    if (match?.[1] === undefined) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(match[1], this.#keys, {
        issuer: HUB_ISSUER,
        audience: HUB_AUDIENCE,
        algorithms: ['EdDSA'],
        maxTokenAge: '90s',
        requiredClaims: ['exp', 'iat', 'jti'],
      });
      request.hubTenantId = Claims.parse(payload).tnt;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
