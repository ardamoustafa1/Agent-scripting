import { createHash } from 'node:crypto';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

import { ConflictError } from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { RedisService } from '../../infra/redis/redis.service.js';

import { PaymentTokenSchema } from './domain/runtime.js';
import { RuntimePorts, type SecureTokenVerifier } from './runtime-ports.js';

const Profile = z.strictObject({
  tenantId: z.uuid(),
  url: z.url().startsWith('https://'),
  issuer: z.url().startsWith('https://'),
  jwks: z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(8) }),
});
const Claims = z.strictObject({
  iss: z.string(),
  aud: z.literal('verbis-secure-field'),
  nbf: z.number().optional(),
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  variable: z.string().max(128),
  token: PaymentTokenSchema,
  jti: z.string().min(16).max(128),
  exp: z.number(),
  iat: z.number(),
});
/** Operator-provisioned tenant PSP public keys. No remote JWKS fetch or client-selected issuer. */
@Injectable()
export class SecureCaptureService implements SecureTokenVerifier, OnModuleInit {
  private readonly profiles = new Map<string, z.infer<typeof Profile>>();
  constructor(
    @Inject(API_ENV) env: ApiEnv,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RuntimePorts) private readonly ports: RuntimePorts,
  ) {
    const input: unknown = JSON.parse(env.PSP_TENANT_PROFILES ?? '[]');
    for (const profile of z.array(Profile).max(1000).parse(input)) {
      for (const address of [profile.url, profile.issuer]) {
        const url = new URL(address);
        if (url.username || url.password || url.hash)
          throw new Error('PSP URL must not contain credentials or fragments');
      }
      if (this.profiles.has(profile.tenantId)) throw new Error('Duplicate tenant PSP profile');
      for (const key of profile.jwks.keys) {
        if ('d' in key || 'k' in key || !['EC', 'OKP'].includes(String(key['kty'])))
          throw new Error('PSP JWKS must contain public asymmetric keys only');
      }
      this.profiles.set(profile.tenantId, profile);
    }
  }
  onModuleInit(): void {
    if (this.profiles.size) this.ports.registerTokenVerifier(this);
  }
  publicProfile(tenantId: string): { url: string; origin: string } | undefined {
    const profile = this.profiles.get(tenantId);
    return profile ? { url: profile.url, origin: new URL(profile.url).origin } : undefined;
  }
  async verify(input: Parameters<SecureTokenVerifier['verify']>[0]): Promise<{ token: string }> {
    const profile = this.profiles.get(input.tenantId);
    if (!profile) throw new ConflictError('Secure capture is not configured for this tenant');
    try {
      const verified = await jwtVerify(input.receipt, createLocalJWKSet(profile.jwks), {
        algorithms: ['ES256', 'EdDSA'],
        issuer: profile.issuer,
        audience: 'verbis-secure-field',
        requiredClaims: ['exp', 'iat', 'jti'],
        maxTokenAge: '2m',
        clockTolerance: 5,
      });
      const claims = Claims.parse(verified.payload);
      if (
        claims.tenantId !== input.tenantId ||
        claims.sessionId !== input.sessionId ||
        claims.variable !== input.variable ||
        claims.exp - claims.iat > 120
      )
        throw new Error('Receipt binding');
      const digest = createHash('sha256').update(`${profile.issuer}:${claims.jti}`).digest('hex');
      const accepted = await this.redis.client.set(
        `secure-receipt:${input.tenantId}:${digest}`,
        'used',
        'EX',
        180,
        'NX',
      );
      if (accepted !== 'OK') throw new Error('Receipt replay');
      return { token: claims.token };
    } catch {
      throw new ConflictError('Secure receipt verification failed');
    }
  }
}
