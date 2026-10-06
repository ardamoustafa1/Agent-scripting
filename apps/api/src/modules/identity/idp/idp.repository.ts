import { Injectable } from '@nestjs/common';

import {
  OidcConfigSchema,
  SamlConfigSchema,
  type OidcConfig,
  type SamlConfig,
} from './idp-config.js';

import type { TransactionClient } from '../../../infra/database/prisma.service.js';

interface IdpBase {
  readonly id: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly status: 'draft' | 'active' | 'disabled';
  readonly jitProvisioning: boolean;
  readonly scimEnabled: boolean;
  readonly domainHints: readonly string[];
  readonly version: number;
}
export type OidcIdp = IdpBase & { readonly protocol: 'oidc'; readonly config: OidcConfig };
export type SamlIdp = IdpBase & { readonly protocol: 'saml'; readonly config: SamlConfig };
export type LoadedIdp = OidcIdp | SamlIdp;

const SELECT = {
  id: true,
  tenantId: true,
  protocol: true,
  displayName: true,
  status: true,
  jitProvisioning: true,
  scimEnabled: true,
  domainHints: true,
  config: true,
  version: true,
} as const;

interface Row {
  id: string;
  tenantId: string;
  protocol: 'oidc' | 'saml';
  displayName: string;
  status: 'draft' | 'active' | 'disabled';
  jitProvisioning: boolean;
  scimEnabled: boolean;
  domainHints: string[];
  config: unknown;
  version: number;
}

/** Parses the stored config; a row whose config no longer validates is treated as unusable. */
export function toLoadedIdp(row: Row): LoadedIdp | undefined {
  const base = {
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    status: row.status,
    jitProvisioning: row.jitProvisioning,
    scimEnabled: row.scimEnabled,
    domainHints: row.domainHints,
    version: row.version,
  };
  if (row.protocol === 'oidc') {
    const config = OidcConfigSchema.safeParse(row.config);
    return config.success ? { ...base, protocol: 'oidc', config: config.data } : undefined;
  }
  const config = SamlConfigSchema.safeParse(row.config);
  return config.success ? { ...base, protocol: 'saml', config: config.data } : undefined;
}

@Injectable()
export class IdpRepository {
  async find(tx: TransactionClient, tenantId: string, id: string): Promise<LoadedIdp | undefined> {
    const row = await tx.identityProvider.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: SELECT,
    });
    return row === null ? undefined : toLoadedIdp(row);
  }

  async findActive(
    tx: TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<LoadedIdp | undefined> {
    const idp = await this.find(tx, tenantId, id);
    return idp?.status === 'active' ? idp : undefined;
  }

  async listActive(tx: TransactionClient, tenantId: string): Promise<LoadedIdp[]> {
    const rows = await tx.identityProvider.findMany({
      where: { tenantId, deletedAt: null, status: 'active' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: SELECT,
    });
    return rows.map(toLoadedIdp).filter((idp): idp is LoadedIdp => idp !== undefined);
  }
}
