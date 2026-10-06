import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { importJWK, SignJWT, type JWK } from 'jose';
import { z } from 'zod';

import { isProblemCode } from '@verbis/shared-types';

import { DomainError } from '../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../env.js';

export const HUB_AUDIENCE = 'verbis-connector-hub';
export const HUB_ISSUER = 'verbis-api';
const TIMEOUT_MS = 5_000;

/**
 * API → connector-hub calls. Authenticated with a 60 s EdDSA token signed by the API's
 * INTERNAL_JWT_SIGNING_JWK (audience `verbis-connector-hub`, tenant-scoped `tnt`); the hub trusts
 * the public part (HUB_TRUSTED_JWKS). Fails closed when unconfigured.
 */
@Injectable()
export class HubClient {
  #key: Promise<{ key: Awaited<ReturnType<typeof importJWK>>; kid: string }> | undefined;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get configured(): boolean {
    return this.env.CONNECTOR_HUB_URL !== '' && this.env.INTERNAL_JWT_SIGNING_JWK !== undefined;
  }

  async call<T>(
    tenantId: string,
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    if (!this.configured)
      throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE', 'Connector hub is not configured');
    const { key, kid } = await this.signingKey();
    const token = await new SignJWT({ tnt: tenantId, typ: 'service', scp: ['manage:Connector'] })
      .setProtectedHeader({ alg: 'EdDSA', kid })
      .setIssuer(HUB_ISSUER)
      .setAudience(HUB_AUDIENCE)
      .setSubject('verbis-api')
      .setIssuedAt()
      .setExpirationTime('60s')
      .setJti(randomUUID())
      .sign(key);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.env.CONNECTOR_HUB_URL), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE', 'Connector hub is unreachable');
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = z.object({ code: z.string() }).safeParse(json);
      if (
        response.status < 500 &&
        code.success &&
        code.data.code.startsWith('VERBIS_CONNECTOR_') &&
        isProblemCode(code.data.code)
      )
        throw new DomainError(code.data.code, undefined, [
          {
            path: '/connector',
            code: code.data.code,
            message: 'The connector rejected this operation',
          },
        ]);
      if ([401, 403].includes(response.status))
        throw new DomainError('VERBIS_CONNECTOR_ACCESS_DENIED');
      if (response.status === 429) throw new DomainError('VERBIS_CONNECTOR_RATE_LIMITED');
      if (response.status === 404)
        throw new DomainError('VERBIS_RESOURCE_NOT_FOUND', 'Not found on the connector hub');
      if (response.status === 422 || response.status === 400)
        throw new DomainError(
          'VERBIS_CONNECTOR_PAYLOAD_REJECTED',
          'The connector rejected the request',
          [{ path: '/connector', message: 'Check the connector input and channel capacity' }],
        );
      throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE', 'Connector hub request failed');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE', 'Unexpected connector hub response');
    return parsed.data;
  }

  private signingKey() {
    this.#key ??= (async () => {
      const jwk = JSON.parse(this.env.INTERNAL_JWT_SIGNING_JWK ?? '{}') as JWK & { kid?: string };
      if (typeof jwk.kid !== 'string') throw new Error('INTERNAL_JWT_SIGNING_JWK needs a kid');
      return { key: await importJWK(jwk, 'EdDSA'), kid: jwk.kid };
    })();
    return this.#key;
  }
}
