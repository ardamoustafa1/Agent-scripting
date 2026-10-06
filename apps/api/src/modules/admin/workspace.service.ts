import { X509Certificate } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { importJWK } from 'jose';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import {
  CtiIdentitiesSchema,
  CtiIdentityInputSchema,
  AdminTenantInputSchema,
  AdminPublicJwksSchema,
} from '@verbis/shared-types';

import { currentActor } from '../../common/actor.js';
import { requestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { HubClient } from '../connectors/hub-client.js';
import { createIdpFetch } from '../identity/egress/idp-fetch.js';

import {
  AdminConnectorInputSchema,
  ConnectorConfigSchema,
  IssuerInputSchema,
  IdpDiscoveryViewSchema,
} from './workspace.dto.js';

import type { Prisma } from '../../generated/prisma/client.js';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  region: string;
  status: string;
  version: number;
  settings: { quotas?: unknown; features?: unknown };
}
function tenantView(row: TenantRow) {
  const { settings: _settings, ...view } = row;
  return {
    ...view,
    quotas: row.settings.quotas ?? { maxUsers: 1000, maxScripts: 1000, maxActiveSessions: 1000 },
    features: row.settings.features ?? {},
  };
}
export function parseSamlMetadata(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ConflictError('Invalid SAML metadata');
  try {
    SyntaxValidator.validate(xml);
  } catch {
    throw new ConflictError('Invalid SAML metadata');
  }
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) =>
      ['EntityDescriptor', 'KeyDescriptor', 'X509Certificate', 'SingleSignOnService'].includes(
        name,
      ),
  }).parse(xml);
  const root = z
    .object({ EntityDescriptor: z.array(z.record(z.string(), z.unknown())) })
    .parse(parsed);
  if (root.EntityDescriptor.length !== 1) throw new ConflictError('Select exactly one IdP entity');
  const entity = root.EntityDescriptor[0];
  if (!entity) throw new ConflictError('Missing IdP entity');
  const descriptor = z.record(z.string(), z.unknown()).parse(entity['IDPSSODescriptor']);
  const endpoints = z
    .array(z.object({ '@_Binding': z.string(), '@_Location': z.url() }))
    .parse(descriptor['SingleSignOnService']);
  const sso = endpoints.find(
    (endpoint) => endpoint['@_Binding'] === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  );
  if (!sso) throw new ConflictError('Missing redirect SSO endpoint');
  const keys = z.array(z.record(z.string(), z.unknown())).parse(descriptor['KeyDescriptor']);
  const certificates: string[] = [];
  for (const key of keys) {
    if (key['@_use'] === 'encryption') continue;
    const info = z
      .object({ X509Data: z.object({ X509Certificate: z.array(z.string()) }) })
      .parse(key['KeyInfo']);
    for (const certificate of info.X509Data.X509Certificate) {
      const body = certificate.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/=]+$/.test(body)) throw new ConflictError('Invalid certificate');
      const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
      try {
        new X509Certificate(pem);
      } catch {
        throw new ConflictError('Invalid certificate');
      }
      certificates.push(pem);
    }
  }
  if (!certificates.length || certificates.length > 5)
    throw new ConflictError('Invalid signing certificates');
  return {
    idpEntityId: z.string().parse(entity['@_entityID']),
    ssoUrl: sso['@_Location'],
    idpCertificates: certificates,
  };
}
@Injectable()
export class AdminWorkspaceService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HubClient) private readonly hub: HubClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}
  private platform() {
    const ctx = requestContext.require();
    if (
      ctx.principal?.type !== 'user' ||
      ctx.principal.authMethod !== 'sso' ||
      !ctx.authz?.roles.includes('super_admin')
    )
      throw new ForbiddenError();
    return ctx.principal.id;
  }
  async tenants() {
    const actor = this.platform();
    const rows = await this.db.current().$queryRaw<
      { value: TenantRow[] }[]
    >`SELECT admin_tenant_list(${actor}::uuid) AS value`;
    await this.audit.record(this.db.current(), {
      action: 'admin.tenants.read',
      target: { type: 'TenantRegistry', id: this.db.tenantId() },
    });
    return (rows[0]?.value ?? []).map(tenantView);
  }
  async tenant(input: z.infer<typeof AdminTenantInputSchema>, id = uuidv7(), version?: number) {
    const actor = this.platform();
    const payload = JSON.stringify(input);
    let rows: { value: TenantRow }[];
    try {
      rows = await this.db.current().$queryRaw<
        { value: TenantRow }[]
      >`SELECT admin_tenant_write(${actor}::uuid,${id}::uuid,${payload}::jsonb,${version ?? null}::integer) AS value`;
    } catch (error) {
      const problem = z.object({ meta: z.object({ code: z.string() }) }).safeParse(error);
      if (problem.success && problem.data.meta.code === '40001') throw new VersionMismatchError();
      if (problem.success && problem.data.meta.code === '42501') throw new ForbiddenError();
      throw error;
    }
    const row = rows[0]?.value;
    if (!row) throw new ConflictError('Tenant update failed');
    await this.audit.record(this.db.current(), {
      action: version === undefined ? 'admin.tenant.created' : 'admin.tenant.updated',
      target: { type: 'Tenant', id },
      metadata: {
        status: input.status,
        quotaKeys: Object.keys(input.quotas),
        featureKeys: Object.keys(input.features),
      },
    });
    return tenantView(row);
  }
  async operations() {
    const tenantId = this.db.tenantId();
    const rows = await this.db.current().$queryRaw<
      { total: bigint; failed: bigint }[]
    >`SELECT count(*) AS total,count(*) FILTER(WHERE outcome='failure') AS failed FROM audit_events WHERE tenant_id=${tenantId}::uuid AND occurred_at>=now()-interval '24 hours' AND action='integration.datasource.executed'`;
    const row = rows[0],
      total = Number(row?.total ?? 0n),
      failed = Number(row?.failed ?? 0n);
    return {
      windowHours: 24,
      source: 'integration.datasource.executed',
      total,
      failed,
      errorRate: total ? failed / total : null,
    };
  }
  async secretUsage(id: string) {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    if (!(await tx.secret.count({ where: { tenantId, id, deletedAt: null } })))
      throw new NotFoundError('Secret');
    const rows = await tx.dataSource.findMany({
      where: { tenantId, deletedAt: null, secretRefs: { has: id } },
      select: { id: true, key: true, protocol: true },
      take: 501,
    });
    await this.audit.record(tx, {
      action: 'admin.secret.usageRead',
      target: { type: 'Secret', id },
    });
    const tenant = await tx.tenant.findFirstOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const ai = z
      .object({
        ai: z
          .object({ secretRef: z.string().nullable().optional(), enabled: z.boolean().optional() })
          .optional(),
      })
      .parse(tenant.settings);
    return {
      data: rows.slice(0, 500),
      truncated: rows.length > 500,
      ai: ai.ai?.secretRef === id ? { enabled: ai.ai.enabled ?? false } : null,
    };
  }
  async connector(
    input: z.infer<typeof AdminConnectorInputSchema>,
    id = uuidv7(),
    version?: number,
  ) {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    if (
      input.secretRefs.length &&
      (await tx.secret.count({
        where: { id: { in: input.secretRefs }, tenantId, deletedAt: null },
      })) !== new Set(input.secretRefs).size
    )
      throw new ForbiddenError();
    const data = {
      ...input,
      tenantId,
      config: input.config as Prisma.InputJsonValue,
      updatedBy: currentActor(),
    };
    let row;
    if (version === undefined)
      row = await tx.connector.create({ data: { ...data, id, createdBy: currentActor() } });
    else {
      const changed = await tx.connector.updateMany({
        where: { id, tenantId, version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count) throw new VersionMismatchError();
      row = await tx.connector.findFirst({ where: { id, tenantId } });
    }
    if (!row) throw new NotFoundError('Connector');
    await this.audit.record(tx, {
      action: 'admin.connector.configured',
      target: { type: 'Connector', id },
      metadata: { adapter: input.adapterType, status: input.status },
    });
    return { id, version: row.version, ...input };
  }
  async connectorHealth(id: string) {
    const connector = await this.db
      .current()
      .connector.findFirst({ where: { id, tenantId: this.db.tenantId(), deletedAt: null } });
    if (!connector) throw new NotFoundError('Connector');
    const state = await this.hub.call(
      this.db.tenantId(),
      'GET',
      '/internal/v1/connectors',
      z.object({ connectors: z.array(z.record(z.string(), z.unknown())) }),
    );
    const entry = state.connectors.find((row) => row['connectorId'] === id);
    await this.audit.record(this.db.current(), {
      action: 'admin.connector.tested',
      target: { type: 'Connector', id },
      metadata: { running: Boolean(entry) },
    });
    return entry ?? { connectorId: id, state: 'not_running' };
  }
  async connectorDetail(id: string) {
    const row = await this.db.current().connector.findFirst({
      where: { id, tenantId: this.db.tenantId(), deletedAt: null },
      select: {
        id: true,
        adapterType: true,
        platform: true,
        status: true,
        config: true,
        secretRefs: true,
        health: true,
        version: true,
      },
    });
    if (!row) throw new NotFoundError('Connector');
    return { ...row, config: ConnectorConfigSchema.parse(row.config) };
  }
  async discover(url: string) {
    const target = new URL(url);
    const issuerInput = target.href.replace(/\/.well-known\/openid-configuration$/, '');
    const requestUrl = target.pathname.endsWith('/.well-known/openid-configuration')
      ? target.href
      : `${target.href.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const fetcher = createIdpFetch({
      allowHttpHosts: this.env.IDENTITY_EGRESS_ALLOW_HTTP_HOSTS,
      allowPrivateHosts: this.env.IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS,
      maxResponseBytes: 256000,
      timeoutMs: 5000,
    });
    const response = await fetcher(requestUrl);
    if (!response.ok) throw new ConflictError('Identity discovery failed');
    const document = z
      .object({
        issuer: z.url(),
        authorization_endpoint: z.url(),
        token_endpoint: z.url(),
        jwks_uri: z.url(),
      })
      .parse(await response.json());
    if (document.issuer.replace(/\/$/, '') !== issuerInput.replace(/\/$/, ''))
      throw new ConflictError('Issuer mismatch');
    await this.audit.record(this.db.current(), {
      action: 'admin.idp.discoveryTested',
      target: { type: 'IdentityProvider', id: 'discovery' },
      metadata: { protocol: 'oidc' },
    });
    return IdpDiscoveryViewSchema.parse({
      issuer: document.issuer,
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
      jwksUri: document.jwks_uri,
    });
  }
  async testIdentity(id: string) {
    const row = await this.db.current().identityProvider.findFirst({
      where: { id, tenantId: this.db.tenantId(), deletedAt: null },
      select: { protocol: true, config: true },
    });
    if (!row) throw new NotFoundError('IdentityProvider');
    const config = z.record(z.string(), z.unknown()).parse(row.config);
    if (row.protocol === 'oidc')
      return {
        ...(await this.discover(z.string().parse(config['issuer']))),
        protocol: 'oidc',
        stage: 'discovery',
      };
    const fetcher = createIdpFetch({
      allowHttpHosts: this.env.IDENTITY_EGRESS_ALLOW_HTTP_HOSTS,
      allowPrivateHosts: this.env.IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS,
      maxResponseBytes: 256000,
      timeoutMs: 5000,
    });
    const response = await fetcher(z.string().parse(config['ssoUrl']));
    await this.audit.record(this.db.current(), {
      action: 'admin.idp.connectionTested',
      target: { type: 'IdentityProvider', id },
      metadata: { httpStatus: response.status, protocol: 'saml' },
    });
    return { protocol: 'saml', stage: 'endpoint', httpStatus: response.status, reachable: true };
  }
  async issuers() {
    return this.db.current().launchTrustedIssuer.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      select: { id: true, issuer: true, jwks: true, status: true, version: true },
    });
  }
  async issuer(input: z.infer<typeof IssuerInputSchema>, id = uuidv7(), version?: number) {
    for (const key of input.jwks.keys) {
      if (
        Buffer.from(key.x, 'base64url').length !== 32 ||
        (key.y && Buffer.from(key.y, 'base64url').length !== 32)
      )
        throw new ConflictError('Invalid public key');
      try {
        await importJWK(
          { kty: key.kty, crv: key.crv, x: key.x, ...(key.y ? { y: key.y } : {}) },
          key.kty === 'EC' ? 'ES256' : 'EdDSA',
        );
      } catch {
        throw new ConflictError('Invalid public key');
      }
    }
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const data = {
      ...input,
      jwks: AdminPublicJwksSchema.parse(input.jwks) as Prisma.InputJsonValue,
      tenantId,
      updatedBy: currentActor(),
    };
    if (version === undefined)
      await tx.launchTrustedIssuer.create({ data: { ...data, id, createdBy: currentActor() } });
    else {
      const result = await tx.launchTrustedIssuer.updateMany({
        where: { id, tenantId, version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      if (!result.count) throw new VersionMismatchError();
    }
    await this.audit.record(tx, {
      action: 'admin.launchIssuer.rotated',
      target: { type: 'LaunchTrustedIssuer', id },
      metadata: { kids: input.jwks.keys.map((key) => key.kid) },
    });
    return { id, ...input, version: version === undefined ? 1 : version + 1 };
  }
  async mapping(id: string, raw: z.input<typeof CtiIdentityInputSchema>) {
    const input = CtiIdentityInputSchema.parse(raw);
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    await tx.$queryRaw`SELECT id FROM tenants WHERE id=${tenantId}::uuid FOR UPDATE`;
    const duplicate = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM users WHERE tenant_id=${tenantId}::uuid AND id<>${id}::uuid AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cti_identities)='array' THEN cti_identities ELSE '[]'::jsonb END) AS identity WHERE regexp_replace(lower(btrim(identity->>'platform')), '[[:space:]_-]+', '-', 'g')=${input.platform} AND COALESCE(identity->>'id', identity->>'platformUserId')=${input.id}) LIMIT 1`;
    if (duplicate.length) throw new ConflictError('Platform identity already mapped');
    await tx.$queryRaw`SELECT id FROM users WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
    const user = await tx.user.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!user) throw new NotFoundError('User');
    if (
      !requestContext
        .require()
        .authz?.ability.can('update', asSubject('User', { id: user.id, tenantId }))
    )
      throw new ForbiddenError();
    const existing = CtiIdentitiesSchema.parse(user.ctiIdentities);
    const identities = [...existing.filter((item) => item.platform !== input.platform), input];
    await tx.user.update({
      where: { id },
      data: {
        ctiIdentities: identities,
        version: { increment: 1 },
        updatedBy: currentActor(),
      },
    });
    await this.audit.record(tx, {
      action: 'admin.connector.userMapped',
      target: { type: 'User', id },
      metadata: { platform: input.platform },
    });
    return { id, ctiIdentities: identities };
  }
}
