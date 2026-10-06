import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { currentActor } from '../../../common/actor.js';
import { uuidv7 } from '../../../common/crypto/uuid.js';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  VersionMismatchError,
} from '../../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { AuditService } from '../../audit/audit.service.js';
import { AppOrigins } from '../core/app-origins.js';
import { IdentitySecrets } from '../core/identity-secrets.js';
import { APP_ORIGINS, IDENTITY_CLOCK, SESSION_STORE, type Clock } from '../core/identity.tokens.js';
import { randomToken, sha256Hex } from '../crypto/random.js';
import {
  OidcConfigSchema,
  SamlConfigSchema,
  type OidcConfig,
  type SamlConfig,
  type SpCredential,
} from '../idp/idp-config.js';
import { IdpRepository, type LoadedIdp } from '../idp/idp.repository.js';
import { OidcService } from '../oidc/oidc.service.js';
import { generateSpCredential } from '../saml/sp-credentials.js';
import { SessionService } from '../session/session.service.js';

import type { CreateIdpInput, IdentityProviderDetail, UpdateIdpInput } from './idp-admin.dto.js';
import type { TransactionClient } from '../../../infra/database/prisma.service.js';
import type { SessionStore } from '../session/session-store.js';

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Tenant administration of identity providers: OIDC/SAML configuration (secrets write-only),
 * claimed email domains (unique across tenants), SP certificate rotation and SCIM tokens.
 * Disabling or deleting an IdP ends every session that came through it.
 */
@Injectable()
export class IdpAdminService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(IdpRepository) private readonly idps: IdpRepository,
    @Inject(IdentitySecrets) private readonly secrets: IdentitySecrets,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(APP_ORIGINS) private readonly origins: AppOrigins,
    @Inject(IDENTITY_CLOCK) private readonly now: Clock,
  ) {}

  async get(id: string): Promise<IdentityProviderDetail> {
    const tx = this.db.current();
    const idp = await this.idps.find(tx, this.db.tenantId(), id);
    if (idp === undefined) throw new NotFoundError('Identity provider');
    return this.detail(tx, idp);
  }

  async create(input: CreateIdpInput): Promise<IdentityProviderDetail> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const actor = currentActor();
    const id = uuidv7(this.now());
    let config: OidcConfig | SamlConfig;
    if (input.protocol === 'oidc') {
      const { clientSecret, ...rest } = input.config;
      const clientSecretRef =
        clientSecret === undefined
          ? undefined
          : await this.secrets.put(
              tx,
              tenantId,
              `idp:${id}:client-secret`,
              'oauth_client',
              clientSecret,
            );
      config = OidcConfigSchema.parse({
        ...rest,
        ...(clientSecretRef === undefined ? {} : { clientSecretRef }),
      });
    } else {
      config = SamlConfigSchema.parse({
        ...input.config,
        spCredentials: await this.newSpCredentials(tx, tenantId, id),
      });
    }
    this.assertActivatable(input.protocol, config, input.status);
    await tx.identityProvider.create({
      data: {
        id,
        tenantId,
        protocol: input.protocol,
        displayName: input.displayName,
        config: config,
        domainHints: input.domains,
        jitProvisioning: input.jitProvisioning,
        scimEnabled: input.scimEnabled,
        status: input.status,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await this.syncDomains(tx, tenantId, id, input.domains);
    const created = await this.get(id);
    await this.audit.record(tx, {
      action: 'identity.identityProvider.created',
      target: { type: 'IdentityProvider', id, name: input.displayName },
      after: this.auditView(created),
    });
    await this.outbox.record(tx, {
      type: 'verbis.identity.identityProvider.created.v1',
      aggregateType: 'IdentityProvider',
      aggregateId: id,
      payload: { protocol: input.protocol, status: input.status },
    });
    return created;
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateIdpInput,
  ): Promise<IdentityProviderDetail> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const current = await this.idps.find(tx, tenantId, id);
    if (current === undefined) throw new NotFoundError('Identity provider');
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    const before = await this.detail(tx, current);
    let config: OidcConfig | SamlConfig = current.config;
    if (input.config !== undefined) {
      if (current.protocol === 'oidc') {
        const parsed = OidcConfigSchema.omit({ clientSecretRef: true })
          .extend({ clientSecret: z.string().min(1).max(1024).optional() })
          .safeParse(input.config);
        if (!parsed.success) throw this.invalid('config does not match the OIDC schema');
        const { clientSecret, ...rest } = parsed.data;
        const clientSecretRef =
          clientSecret === undefined
            ? current.config.clientSecretRef
            : await this.secrets.put(
                tx,
                tenantId,
                `idp:${id}:client-secret`,
                'oauth_client',
                clientSecret,
              );
        config = OidcConfigSchema.parse({
          ...rest,
          ...(clientSecretRef === undefined ? {} : { clientSecretRef }),
        });
      } else {
        const parsed = SamlConfigSchema.omit({ spCredentials: true }).safeParse(input.config);
        if (!parsed.success) throw this.invalid('config does not match the SAML schema');
        config = SamlConfigSchema.parse({
          ...parsed.data,
          spCredentials: current.config.spCredentials,
        });
      }
    }
    const status = input.status ?? current.status;
    this.assertActivatable(current.protocol, config, status);
    const updated = await tx.identityProvider.updateMany({
      where: { id, tenantId, version: expectedVersion, deletedAt: null },
      data: {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.domains === undefined ? {} : { domainHints: input.domains }),
        ...(input.jitProvisioning === undefined ? {} : { jitProvisioning: input.jitProvisioning }),
        ...(input.scimEnabled === undefined ? {} : { scimEnabled: input.scimEnabled }),
        status,
        config: config,
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw new VersionMismatchError();
    if (input.domains !== undefined) await this.syncDomains(tx, tenantId, id, input.domains);
    this.oidc.forget(id);
    const after = await this.get(id);
    await this.audit.record(tx, {
      action: 'identity.identityProvider.updated',
      target: { type: 'IdentityProvider', id, name: after.displayName },
      before: this.auditView(before),
      after: {
        ...this.auditView(after),
        ...(input.config !== undefined && 'clientSecret' in input.config
          ? { clientSecretRotated: true }
          : {}),
      },
    });
    if (current.status === 'active' && status !== 'active')
      await this.endSessions(id, 'idp_disabled');
    return after;
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const current = await this.idps.find(tx, tenantId, id);
    if (current === undefined) throw new NotFoundError('Identity provider');
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    const now = new Date(this.now());
    const actor = currentActor();
    await tx.identityProvider.update({
      where: { id },
      data: { deletedAt: now, status: 'disabled', updatedBy: actor, version: { increment: 1 } },
    });
    await tx.identityProviderDomain.updateMany({
      where: { tenantId, idpId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actor },
    });
    await tx.scimToken.updateMany({
      where: { tenantId, idpId: id, revokedAt: null },
      data: { revokedAt: now, updatedBy: actor },
    });
    if (current.protocol === 'oidc' && current.config.clientSecretRef !== undefined)
      await this.secrets.remove(tx, tenantId, current.config.clientSecretRef);
    if (current.protocol === 'saml') {
      for (const credential of current.config.spCredentials)
        await this.secrets.remove(tx, tenantId, credential.privateKeyRef);
    }
    this.oidc.forget(id);
    await this.audit.record(tx, {
      action: 'identity.identityProvider.deleted',
      target: { type: 'IdentityProvider', id, name: current.displayName },
      before: { status: current.status, protocol: current.protocol },
    });
    await this.endSessions(id, 'idp_disabled');
  }

  // ─── SAML SP certificate rotation ────────────────────────────────────────────

  /** Generates a `next` credential, published in metadata before it is promoted. */
  async rotateSpCredential(
    id: string,
    use: 'signing' | 'encryption',
  ): Promise<IdentityProviderDetail> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const idp = await this.samlIdp(tx, tenantId, id);
    const existing = idp.config.spCredentials;
    if (existing.some((c) => c.use === use && c.state === 'next'))
      throw new ConflictError(`A next ${use} credential already exists`);
    const credential = await this.spCredential(tx, tenantId, id, use, 'next');
    await this.saveCredentials(tx, idp, [...existing, credential]);
    await this.audit.record(tx, {
      action: 'identity.spCredential.created',
      target: { type: 'IdentityProvider', id },
      after: { credentialId: credential.id, use, state: 'next', notAfter: credential.notAfter },
    });
    return this.get(id);
  }

  /** `next` → `active`; the previous active becomes `retired` (still decrypts until removed). */
  async promoteSpCredential(id: string, credentialId: string): Promise<IdentityProviderDetail> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const idp = await this.samlIdp(tx, tenantId, id);
    const target = idp.config.spCredentials.find((c) => c.id === credentialId);
    if (target?.state !== 'next') throw new ConflictError('Only a next credential can be promoted');
    const next = idp.config.spCredentials.map((c): SpCredential => {
      if (c.id === credentialId) return { ...c, state: 'active' };
      if (c.use === target.use && c.state === 'active') return { ...c, state: 'retired' };
      return c;
    });
    await this.saveCredentials(tx, idp, next);
    await this.audit.record(tx, {
      action: 'identity.spCredential.promoted',
      target: { type: 'IdentityProvider', id },
      after: { credentialId, use: target.use },
    });
    return this.get(id);
  }

  async removeSpCredential(id: string, credentialId: string): Promise<IdentityProviderDetail> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const idp = await this.samlIdp(tx, tenantId, id);
    const target = idp.config.spCredentials.find((c) => c.id === credentialId);
    if (target === undefined) throw new NotFoundError('SP credential');
    if (target.state === 'active')
      throw new ConflictError('The active credential cannot be removed; promote a next one first');
    await this.saveCredentials(
      tx,
      idp,
      idp.config.spCredentials.filter((c) => c.id !== credentialId),
    );
    await this.secrets.remove(tx, tenantId, target.privateKeyRef);
    await this.audit.record(tx, {
      action: 'identity.spCredential.removed',
      target: { type: 'IdentityProvider', id },
      before: { credentialId, use: target.use, state: target.state },
    });
    return this.get(id);
  }

  // ─── SCIM tokens ─────────────────────────────────────────────────────────────

  async issueScimToken(id: string, expiresInDays?: number) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const idp = await this.idps.find(tx, tenantId, id);
    if (idp === undefined) throw new NotFoundError('Identity provider');
    if (!idp.scimEnabled) throw new ConflictError('SCIM is not enabled for this identity provider');
    const token = `vscim_${randomToken(32)}`;
    const actor = currentActor();
    const row = await tx.scimToken.create({
      data: {
        tenantId,
        idpId: id,
        tokenHash: sha256Hex(token),
        prefix: token.slice(0, 12),
        ...(expiresInDays === undefined
          ? {}
          : { expiresAt: new Date(this.now() + expiresInDays * 86_400_000) }),
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await this.audit.record(tx, {
      action: 'identity.scimToken.issued',
      target: { type: 'ScimToken', id: row.id },
      after: { idpId: id, prefix: row.prefix, expiresAt: row.expiresAt?.toISOString() ?? null },
    });
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { slug: true } });
    return {
      ...this.scimTokenView(row),
      token,
      scimBaseUrl: `${this.env.PUBLIC_API_URL}/scim/v2/${tenant?.slug ?? ''}`,
    };
  }

  async listScimTokens(id: string) {
    const rows = await this.db.current().scimToken.findMany({
      where: { tenantId: this.db.tenantId(), idpId: id, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.scimTokenView(row));
  }

  async revokeScimToken(id: string, tokenId: string): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const updated = await tx.scimToken.updateMany({
      where: { id: tokenId, idpId: id, tenantId, revokedAt: null, deletedAt: null },
      data: {
        revokedAt: new Date(this.now()),
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw new NotFoundError('SCIM token');
    await this.audit.record(tx, {
      action: 'identity.scimToken.revoked',
      target: { type: 'ScimToken', id: tokenId },
      after: { idpId: id },
    });
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private scimTokenView(row: {
    id: string;
    prefix: string;
    createdAt: Date;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }) {
    return {
      id: row.id,
      prefix: row.prefix,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }

  private async endSessions(idpId: string, reason: 'idp_disabled'): Promise<void> {
    const revoked = await this.store.revokeByIdp(this.db.tenantId(), idpId);
    await this.sessions.recordEndedInRequest(revoked, reason);
  }

  private invalid(detail: string): DomainError {
    return new DomainError('VERBIS_IDENTITY_IDP_CONFIG_INVALID', detail);
  }

  private assertActivatable(
    protocol: 'oidc' | 'saml',
    config: OidcConfig | SamlConfig,
    status: string,
  ): void {
    if (status !== 'active') return;
    if (protocol === 'oidc' && (config as OidcConfig).clientSecretRef === undefined) {
      throw this.invalid('An active OIDC identity provider needs a client secret');
    }
  }

  private async syncDomains(
    tx: TransactionClient,
    tenantId: string,
    idpId: string,
    domains: readonly string[],
  ): Promise<void> {
    const actor = currentActor();
    const existing = await tx.identityProviderDomain.findMany({
      where: { tenantId, idpId, deletedAt: null },
    });
    const wanted = new Set(domains);
    for (const row of existing) {
      if (!wanted.has(row.domain)) {
        await tx.identityProviderDomain.update({
          where: { id: row.id },
          data: { deletedAt: new Date(this.now()), updatedBy: actor },
        });
      }
    }
    for (const domain of wanted) {
      if (existing.some((row) => row.domain === domain)) continue;
      try {
        // Savepoint: a unique violation must not abort the surrounding request transaction.
        await tx.$executeRaw`SAVEPOINT idp_domain`;
        await tx.identityProviderDomain.create({
          data: { tenantId, idpId, domain, createdBy: actor, updatedBy: actor },
        });
        await tx.$executeRaw`RELEASE SAVEPOINT idp_domain`;
      } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT idp_domain`;
        if (uniqueViolation(error))
          throw new DomainError(
            'VERBIS_IDENTITY_DOMAIN_CLAIMED',
            `The domain ${domain} is already claimed`,
          );
        throw error;
      }
    }
  }

  private async newSpCredentials(
    tx: TransactionClient,
    tenantId: string,
    idpId: string,
  ): Promise<SpCredential[]> {
    return [
      await this.spCredential(tx, tenantId, idpId, 'signing', 'active'),
      await this.spCredential(tx, tenantId, idpId, 'encryption', 'active'),
    ];
  }

  private async spCredential(
    tx: TransactionClient,
    tenantId: string,
    idpId: string,
    use: 'signing' | 'encryption',
    state: 'active' | 'next',
  ): Promise<SpCredential> {
    const id = uuidv7(this.now());
    const generated = await generateSpCredential(`Verbis SP ${use}`, new Date(this.now()));
    const privateKeyRef = await this.secrets.put(
      tx,
      tenantId,
      `idp:${idpId}:sp:${id}`,
      'certificate',
      generated.privateKey,
    );
    return {
      id,
      use,
      state,
      certificate: generated.certificate,
      privateKeyRef,
      notAfter: generated.notAfter.toISOString(),
    };
  }

  private async samlIdp(tx: TransactionClient, tenantId: string, id: string) {
    const idp = await this.idps.find(tx, tenantId, id);
    if (idp?.protocol !== 'saml') throw new NotFoundError('SAML identity provider');
    return idp;
  }

  private async saveCredentials(
    tx: TransactionClient,
    idp: Extract<LoadedIdp, { protocol: 'saml' }>,
    credentials: SpCredential[],
  ) {
    const config = SamlConfigSchema.parse({ ...idp.config, spCredentials: credentials });
    await tx.identityProvider.update({
      where: { id: idp.id },
      data: { config: config, updatedBy: currentActor(), version: { increment: 1 } },
    });
  }

  private async detail(tx: TransactionClient, idp: LoadedIdp): Promise<IdentityProviderDetail> {
    const row = await tx.identityProvider.findFirst({
      where: { id: idp.id },
      select: { createdAt: true, updatedAt: true },
    });
    const slugRow = await tx.tenant.findFirst({
      where: { id: idp.tenantId },
      select: { slug: true },
    });
    const slug = slugRow?.slug ?? '';
    const apps = this.origins.apps();
    const url = (path: string) =>
      apps.map((app) => this.origins.publicUrl(app, slug, path) ?? '').filter((u) => u !== '');
    let config: Record<string, unknown>;
    let endpoints: Record<string, string | string[]>;
    if (idp.protocol === 'oidc') {
      const { clientSecretRef, ...rest } = idp.config;
      config = { ...rest, clientSecretSet: clientSecretRef !== undefined };
      endpoints = {
        redirectUris: url('/auth/oidc/callback'),
        postLogoutRedirectUris: apps.map((app) => `${this.origins.originFor(app, slug) ?? ''}/`),
        backchannelLogoutUri: `${this.env.PUBLIC_API_URL}/auth/oidc/${slug}/${idp.id}/backchannel-logout`,
        frontchannelLogoutUri: url(`/auth/oidc/${slug}/${idp.id}/frontchannel-logout`),
      };
    } else {
      const { spCredentials, ...rest } = idp.config;
      config = {
        ...rest,
        spCredentials: spCredentials.map(({ privateKeyRef: _ref, ...view }) => view),
      };
      endpoints = {
        entityId: `${this.env.PUBLIC_API_URL}/auth/saml/${slug}/${idp.id}`,
        metadataUrl: `${this.env.PUBLIC_API_URL}/auth/saml/${slug}/${idp.id}/metadata`,
        acsUrls: url(`/auth/saml/${slug}/${idp.id}/acs`),
        sloUrls: url(`/auth/saml/${slug}/${idp.id}/slo`),
      };
    }
    const domains = await tx.identityProviderDomain.findMany({
      where: { tenantId: idp.tenantId, idpId: idp.id, deletedAt: null },
      select: { domain: true },
      orderBy: { domain: 'asc' },
    });
    return {
      id: idp.id,
      createdAt: (row?.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
      version: idp.version,
      protocol: idp.protocol,
      displayName: idp.displayName,
      domains: domains.map((d) => d.domain),
      jitProvisioning: idp.jitProvisioning,
      scimEnabled: idp.scimEnabled,
      status: idp.status,
      config,
      endpoints,
    };
  }

  private auditView(detail: IdentityProviderDetail): Record<string, unknown> {
    return {
      protocol: detail.protocol,
      displayName: detail.displayName,
      domains: detail.domains,
      jitProvisioning: detail.jitProvisioning,
      scimEnabled: detail.scimEnabled,
      status: detail.status,
      config: detail.config,
    };
  }
}
