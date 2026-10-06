import { Inject, Injectable } from '@nestjs/common';

import { TenantDb } from '../../../infra/database/tenant-db.js';
import { identityActor, IdentityTx } from '../core/identity-tx.js';
import { IDENTITY_CLOCK, type Clock } from '../core/identity.tokens.js';
import { TenantResolver } from '../core/tenant-resolver.js';
import { sha256Hex } from '../crypto/random.js';

import type { FastifyRequest } from 'fastify';

export const SCIM_TOKEN = /^vscim_[A-Za-z0-9_-]{43}$/;
const PATH = /^\/scim\/v2\/([a-z0-9][a-z0-9-]{0,62})(\/|\?|$)/;
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    /** Tenant slug from the SCIM base URL (`/scim/v2/<slug>`). */
    scimTenantSlug?: string;
  }
}

/**
 * SCIM bearer tokens (SECURITY §5.4): one per IdP/tenant, only the SHA-256 is stored, revocable,
 * optional expiry. A valid token yields a service principal `scim:<idpId>` that may manage users
 * and groups of its tenant; the tenant comes from the URL and must match the token's tenant.
 */
@Injectable()
export class ScimAuthenticator {
  constructor(
    @Inject(TenantResolver) private readonly tenants: TenantResolver,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(IDENTITY_CLOCK) private readonly now: Clock,
  ) {}

  async authenticate(request: FastifyRequest): Promise<void> {
    const slug = PATH.exec(request.url)?.[1];
    if (slug === undefined) return;
    request.scimTenantSlug = slug;
    const header = request.headers.authorization;
    if (header === undefined) return;
    const token = /^Bearer (\S+)$/.exec(header)?.[1];
    const tenant = await this.tenants.bySlug(slug);
    if (token === undefined || !SCIM_TOKEN.test(token) || tenant?.status !== 'active') {
      request.authRejected = true;
      return;
    }
    const now = new Date(this.now());
    const row = await this.db.run(tenant.id, async (tx) => {
      const found = await tx.scimToken.findFirst({
        where: {
          tenantId: tenant.id,
          tokenHash: sha256Hex(token),
          revokedAt: null,
          deletedAt: null,
        },
        select: {
          id: true,
          idpId: true,
          expiresAt: true,
          lastUsedAt: true,
          idp: { select: { scimEnabled: true, status: true, deletedAt: true } },
        },
      });
      if (
        found !== null &&
        (found.lastUsedAt === null ||
          now.getTime() - found.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS)
      ) {
        await tx.scimToken.update({ where: { id: found.id }, data: { lastUsedAt: now } });
      }
      return found;
    });
    const usable =
      row !== null &&
      (row.expiresAt === null || row.expiresAt > now) &&
      row.idp.scimEnabled &&
      row.idp.status === 'active' &&
      row.idp.deletedAt === null;
    if (!usable) {
      request.authRejected = true;
      // Security signal: a wrong or revoked SCIM credential was presented for this tenant.
      await this.identityTx.record(tenant.id, identityActor(tenant.id), {
        action: 'identity.scimToken.rejected',
        target: { type: 'ScimToken', id: row?.id ?? 'unknown' },
        outcome: 'denied',
      });
      return;
    }
    request.principal = {
      type: 'service',
      id: `scim:${row.idpId}`,
      tenantId: tenant.id,
      scopes: ['manage:User', 'manage:Group'],
    };
  }
}
