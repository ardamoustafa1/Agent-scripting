import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infra/database/prisma.service.js';

export interface ResolvedTenant {
  readonly id: string;
  readonly slug: string;
  readonly status: 'provisioning' | 'active' | 'suspended' | 'deleting';
}

export interface DiscoveredRealm {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly idpId: string;
}

export const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Resolves tenants before any tenant context exists (login, SCIM, token endpoint) through the
 * narrow SECURITY DEFINER lookups `tenant_resolve` and `identity_discover_domain` (ADR-0012).
 */
@Injectable()
export class TenantResolver {
  readonly #cache = new Map<string, { value: ResolvedTenant | undefined; expires: number }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async bySlug(slug: string): Promise<ResolvedTenant | undefined> {
    if (!TENANT_SLUG.test(slug)) return undefined;
    const hit = this.#cache.get(slug);
    if (hit !== undefined && hit.expires > Date.now()) return hit.value;
    const rows = await this.prisma.client.$queryRaw<
      { id: string; status: ResolvedTenant['status'] }[]
    >`SELECT id, status FROM tenant_resolve(${slug})`;
    const row = rows[0];
    const value = row === undefined ? undefined : { id: row.id, slug, status: row.status };
    if (this.#cache.size > 10_000) this.#cache.clear();
    this.#cache.set(slug, { value, expires: Date.now() + 30_000 });
    return value;
  }

  /** Active IdPs that claim an email domain (home-realm discovery). */
  async byEmailDomain(domain: string): Promise<DiscoveredRealm[]> {
    const rows = await this.prisma.client.$queryRaw<
      { tenant_id: string; tenant_slug: string; idp_id: string }[]
    >`SELECT tenant_id, tenant_slug, idp_id FROM identity_discover_domain(${domain.toLowerCase()})`;
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug,
      idpId: row.idp_id,
    }));
  }
}
