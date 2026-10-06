import { Inject, Injectable } from '@nestjs/common';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import { IntegrationPromotionSchema } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';
import {
  DomainError,
  VersionMismatchError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { previewMayUseLiveData } from '../launch/domain/preview.js';
import { decodeDocument } from '../scripts/document-storage.js';

import {
  DefinitionSchema,
  PolicySchema,
  SaveDataSourceSchema,
  SecretSetSchema,
  type Call,
} from './engine/contracts.js';
import { IntegrationExecutor } from './engine/executor.js';
import { scrubSecrets } from './engine/mapping.js';
import { importWsdl, introspectionQuery } from './engine/protocols.js';
import { secureTransport } from './engine/transport.js';
import { uuidv7 } from './engine/uuid.js';
import { VaultTransitClient } from './engine/vault-transit-client.js';
import { EnvKeyAdapter, EnvelopeVault } from './engine/vault.js';
import { toDataSourceDto, toSecretDto } from './integrations.dto.js';

import type { ApiEnv } from '../../env.js';

export const INTEGRATION_VAULT = Symbol('INTEGRATION_VAULT');
const OriginsSchema = z.object({ integrationAllowedOrigins: z.array(z.url()).default([]) });
const ClaimsSchema = z.object({
  sid: z.uuid(),
  sub: z.string(),
  tnt: z.uuid(),
  bff: z.string(),
  scp: z.literal('integration:execute'),
});
export function environmentVault(env: ApiEnv): EnvelopeVault {
  const transit =
    env.INTEGRATION_KEY_PROVIDER === 'vault-transit'
      ? new VaultTransitClient(env).adapter()
      : undefined;
  const master = () => {
    if (!env.INTEGRATION_MASTER_KEY) throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
    return new EnvKeyAdapter(Buffer.from(env.INTEGRATION_MASTER_KEY, 'base64'));
  };
  // Lazy construction: listing definitions works without a master key; secret operations fail closed.
  return new EnvelopeVault({
    wrap: (tenant, key) => (transit ?? master()).wrap(tenant, key),
    unwrap: (tenant, value) => {
      if (!transit) return master().unwrap(tenant, value);
      if (value.startsWith('vault:')) return transit.unwrap(tenant, value);
      if (env.INTEGRATION_VAULT_ALLOW_LEGACY_DECRYPT) return master().unwrap(tenant, value);
      throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
    },
  });
}
@Injectable()
export class IntegrationEngineService {
  readonly executor: IntegrationExecutor;
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(RedisService) redis: RedisService,
    @Inject(INTEGRATION_VAULT) private readonly vault: EnvelopeVault,
  ) {
    this.executor = new IntegrationExecutor({
      get: (key) => redis.client.get(key),
      set: async (key, value, ttl) => {
        await redis.client.set(key, value, 'EX', ttl);
      },
    });
  }
  private actor() {
    const principal = requestContext.require().principal;
    if (!principal) throw new UnauthenticatedError();
    return principal;
  }
  private async source(id: string, action: 'read' | 'update' | 'execute' = 'read') {
    const row = await this.db
      .current()
      .dataSource.findFirst({ where: { tenantId: this.db.tenantId(), id, deletedAt: null } });
    if (!row) throw new NotFoundError('DataSource');
    this.authz.authorize(action, asSubject('Integration', row));
    return {
      row,
      source: {
        id: row.id,
        version: row.version,
        protocol: row.protocol,
        definition: DefinitionSchema.parse(row.definition),
        policy: PolicySchema.parse(row.policy),
      },
    };
  }
  private async origins() {
    const tenant = await this.db.current().tenant.findFirst({
      where: { id: this.db.tenantId(), status: 'active', deletedAt: null },
      select: { settings: true },
    });
    if (!tenant) throw new ForbiddenError();
    return OriginsSchema.parse(tenant.settings).integrationAllowedOrigins;
  }
  async save(body: z.infer<typeof SaveDataSourceSchema>, id?: string, version?: number) {
    const previous = id ? await this.source(id, 'update') : null;
    if (previous && previous.row.version !== version)
      throw new VersionMismatchError(previous.row.version);
    if (
      JSON.stringify(body.definition.profiles.prod) !==
      JSON.stringify(previous?.source.definition.profiles.prod)
    )
      throw new ForbiddenError('Production profiles require approval');
    if (!previous)
      this.authz.authorize('create', asSubject('Integration', { tenantId: this.db.tenantId() }));
    const actor = this.actor();
    const refs = new Set<string>();
    const auths = [
      body.definition.auth,
      ...Object.values(body.definition.profiles).map((profile) => profile?.auth),
    ];
    for (const auth of auths)
      if (auth && 'secretRef' in auth) {
        const metadata = await this.db.current().secret.findFirst({
          where: { id: auth.secretRef, tenantId: actor.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!metadata) throw new NotFoundError('Secret');
        refs.add(auth.secretRef);
      }
    const definition = JSON.parse(JSON.stringify(body.definition)) as Record<string, never>;
    const policy = JSON.parse(JSON.stringify(body.policy)) as Record<string, never>;
    const data = {
      key: body.key,
      protocol: body.protocol,
      definition,
      policy,
      secretRefs: [...refs],
      updatedBy: actor.id,
    };
    const row = id
      ? await this.db.current().dataSource.update({
          where: { id, tenantId: actor.tenantId, ...(version === undefined ? {} : { version }) },
          data: { ...data, version: { increment: 1 } },
        })
      : await this.db
          .current()
          .dataSource.create({ data: { ...data, tenantId: actor.tenantId, createdBy: actor.id } });
    await this.audit.record(this.db.current(), {
      action: id ? 'integration.datasource.updated' : 'integration.datasource.created',
      target: { type: 'DataSource', id: row.id },
      after: { version: row.version, protocol: row.protocol },
    });
    return toDataSourceDto(row);
  }
  async get(id: string) {
    return toDataSourceDto((await this.source(id)).row);
  }
  async promote(id: string, version: number, input?: z.infer<typeof IntegrationPromotionSchema>) {
    const actor = this.actor();
    const { row, source } = await this.source(id, input ? 'update' : 'read');
    if (row.version !== version) throw new VersionMismatchError(row.version);
    if (!input) this.authz.authorize('approve', asSubject('Integration', row));
    const definition = structuredClone(source.definition);
    if (input) {
      const profile = definition.profiles[input.from];
      if (!profile) throw new ForbiddenError('Source profile required');
      definition.pendingPromotion = {
        ...input,
        profile,
        requestedBy: actor.id,
        requestedAt: new Date().toISOString(),
      };
    } else {
      const pending = definition.pendingPromotion;
      if (!pending || pending.requestedBy === actor.id)
        throw new ForbiddenError('Independent approval required');
      definition.profiles.prod = pending.profile;
      delete definition.pendingPromotion;
    }
    const updated = await this.db.current().dataSource.update({
      where: { id, tenantId: actor.tenantId, version },
      data: {
        definition: JSON.parse(JSON.stringify(definition)) as Record<string, never>,
        version: { increment: 1 },
        updatedBy: actor.id,
      },
    });
    await this.audit.record(this.db.current(), {
      action: input ? 'integration.profile.promotionRequested' : 'integration.profile.promoted',
      target: { type: 'DataSource', id },
      after: { version: updated.version },
      metadata: { environment: 'prod' },
    });
    return toDataSourceDto(updated);
  }
  async usage(id: string) {
    const { row } = await this.source(id);
    const versions = await this.db.current().scriptVersion.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      select: {
        scriptId: true,
        number: true,
        document: true,
        documentCompressed: true,
        documentEncoding: true,
        script: { select: { name: true, tenantId: true, deletedAt: true } },
      },
      take: 1001,
      orderBy: { createdAt: 'desc' },
    });
    const { decodeDocument } = await import('../scripts/document-storage.js');
    const consumers: { scriptId: string; name: string; number: number }[] = [];
    for (const version of versions.slice(0, 1000)) {
      if (version.script.deletedAt || !this.authz.can('read', asSubject('Script', version.script)))
        continue;
      const document = z
        .object({ dataSources: z.array(z.object({ ref: z.string() })) })
        .safeParse(await decodeDocument(version));
      if (
        document.success &&
        document.data.dataSources.some((ref) => ref.ref === `tenant-datasource:${row.key}`)
      )
        consumers.push({
          scriptId: version.scriptId,
          name: version.script.name,
          number: version.number,
        });
    }
    return { data: consumers, truncated: versions.length > 1000 };
  }
  async setSecret(body: z.infer<typeof SecretSetSchema>, id?: string) {
    const actor = this.actor();
    const existing = id
      ? await this.db
          .current()
          .secret.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } })
      : null;
    if (id && !existing) throw new NotFoundError('Secret');
    this.authz.authorize(
      id ? 'update' : 'create',
      asSubject('Secret', existing ?? { tenantId: actor.tenantId }),
    );
    const secretId = id ?? uuidv7();
    const keyVersion = (existing?.keyVersion ?? 0) + 1;
    const ciphertext = new Uint8Array(
      await this.vault.encrypt(actor.tenantId, secretId, keyVersion, body.value),
    );
    const row = existing
      ? await this.db.current().secret.update({
          where: { id: secretId, tenantId: actor.tenantId },
          data: {
            ciphertext,
            keyVersion,
            updatedBy: actor.id,
            rotatedAt: new Date(),
            version: { increment: 1 },
          },
        })
      : await this.db.current().secret.create({
          data: {
            id: secretId,
            tenantId: actor.tenantId,
            name: body.name,
            kind: body.kind,
            ciphertext,
            keyVersion,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
        });
    await this.audit.record(this.db.current(), {
      action: existing ? 'integration.secret.rotated' : 'integration.secret.set',
      target: { type: 'Secret', id: secretId },
      after: { keyVersion },
    });
    this.executor.authentication.invalidate(actor.tenantId);
    return toSecretDto(row);
  }
  private reader(refs: readonly string[]) {
    return async (ref: string) => {
      if (!refs.includes(ref)) throw new ForbiddenError();
      return this.db.run(this.db.tenantId(), async (tx) => {
        const row = await tx.secret.findFirst({
          where: { id: ref, tenantId: this.db.tenantId(), deletedAt: null },
          select: { id: true, ciphertext: true, keyVersion: true },
        });
        if (!row) throw new NotFoundError('Secret');
        const value = await this.vault.decrypt(
          this.db.tenantId(),
          ref,
          row.keyVersion,
          row.ciphertext,
        );
        await this.audit.record(tx, {
          action: 'integration.secret.used',
          target: { type: 'Secret', id: ref },
          after: { keyVersion: row.keyVersion },
        });
        await tx.secret.update({
          where: { id: ref, tenantId: this.db.tenantId() },
          data: { lastUsedAt: new Date() },
        });
        return { value, version: row.keyVersion };
      });
    };
  }
  async draftPreview(body: z.infer<typeof SaveDataSourceSchema>, call: Call) {
    this.authz.authorize('update', asSubject('Integration', { tenantId: this.db.tenantId() }));
    const result = await this.executor.execute(
      this.db.tenantId(),
      {
        id: 'authoring-preview',
        version: 1,
        protocol: body.protocol,
        definition: DefinitionSchema.parse(body.definition),
        policy: body.policy,
      },
      call,
      () => Promise.reject(new ForbiddenError()),
      [],
      { preview: true },
    );
    await this.audit.record(this.db.current(), {
      action: 'integration.datasource.previewed',
      target: { type: 'DataSource', id: '*' },
      outcome: result.trace.error ? 'failure' : 'success',
      metadata: { mock: true, durationMs: result.trace.durationMs },
    });
    return result.trace;
  }
  async console(id: string, input: Call, live = false) {
    const { row, source } = await this.source(id, live ? 'execute' : 'read');
    // Designer live tests are limited to sandbox profiles; preview always uses mock data.
    if (live && input.environment === 'prod') throw new ForbiddenError();
    const result = await this.executor.execute(
      this.db.tenantId(),
      source,
      input,
      this.reader(row.secretRefs),
      await this.origins(),
      { preview: !live },
    );
    await this.audit.record(this.db.current(), {
      action: 'integration.datasource.tested',
      target: { type: 'DataSource', id },
      outcome: result.trace.error ? 'failure' : 'success',
      metadata: {
        environment: input.environment,
        mock: result.trace.mock,
        durationMs: result.trace.durationMs,
        error: result.trace.error,
      },
    });
    return result.trace;
  }
  private async credentialVersion(refs: readonly string[]) {
    const rows = await this.db.current().secret.findMany({
      where: { tenantId: this.db.tenantId(), id: { in: [...refs] }, deletedAt: null },
      select: { id: true, keyVersion: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => `${row.id}.${row.keyVersion}`).join('-');
  }
  async execute(id: string, sessionId: string, token: string | undefined, call: Call) {
    const actor = this.actor();
    if (!token || actor.type !== 'user' || !actor.sessionId) throw new UnauthenticatedError();
    const rawKeys = process.env['INTEGRATION_RUNTIME_JWKS'];
    if (!rawKeys) throw new DomainError('VERBIS_INTEGRATION_UNAVAILABLE');
    try {
      const keys = createLocalJWKSet(JSON.parse(rawKeys) as JSONWebKeySet);
      const { payload } = await jwtVerify(token, keys, {
        issuer: 'verbis-runtime',
        audience: `integrations:${actor.tenantId}`,
        algorithms: ['EdDSA'],
        requiredClaims: ['exp', 'iat', 'sub', 'sid', 'tnt', 'bff', 'scp'],
        maxTokenAge: '5m',
      });
      const claims = ClaimsSchema.parse(payload);
      if (
        claims.sid !== sessionId ||
        claims.sub !== actor.id ||
        claims.tnt !== actor.tenantId ||
        claims.bff !== actor.sessionId
      )
        throw new UnauthenticatedError();
    } catch {
      throw new UnauthenticatedError();
    }
    return this.executeAuthorized(id, sessionId, call);
  }
  /** Server-only BFF bridge; ownership, active session, scoped permission and exact pin are checked below. */
  async executeAuthorized(id: string, sessionId: string, call: Call) {
    const actor = this.actor();
    if (actor.type !== 'user' || !actor.sessionId) throw new UnauthenticatedError();
    const session = await this.db.current().session.findFirst({
      where: {
        id: sessionId,
        tenantId: actor.tenantId,
        userId: actor.id,
        state: 'active',
        endedAt: null,
        deletedAt: null,
      },
      include: {
        scriptVersion: {
          select: { document: true, documentEncoding: true, documentCompressed: true },
        },
      },
    });
    if (!session) throw new ForbiddenError();
    // Designer previews run on mock data unless the preview was started with live-data permission.
    if (!previewMayUseLiveData(session)) throw new ForbiddenError('Preview sessions use mock data');
    const { row, source } = await this.source(id, 'execute');
    const document = z
      .object({ dataSources: z.array(z.object({ ref: z.string(), version: z.number() })) })
      .parse(await decodeDocument(session.scriptVersion));
    if (
      !document.dataSources.some(
        (ref) => ref.ref === `tenant-datasource:${row.key}` && ref.version === row.version,
      )
    )
      throw new ForbiddenError();
    const environment = z
      .enum(['dev', 'test', 'prod'])
      .parse(process.env['VERBIS_ENVIRONMENT'] ?? 'prod');
    const result = await this.executor.execute(
      actor.tenantId,
      source,
      { ...call, environment },
      this.reader(row.secretRefs),
      await this.origins(),
      { sessionId, credentialVersion: await this.credentialVersion(row.secretRefs) },
    );
    await this.db.run(actor.tenantId, async (tx) => {
      await this.audit.record(tx, {
        action: 'integration.datasource.executed',
        target: { type: 'DataSource', id },
        outcome: result.trace.error ? 'failure' : 'success',
        metadata: { sessionId, durationMs: result.trace.durationMs, error: result.trace.error },
      });
      if (session.kind === 'interaction') {
        const pinned = z
          .object({
            dataSources: z.array(
              z.object({ id: z.string(), ref: z.string(), version: z.number() }),
            ),
          })
          .parse(await decodeDocument(session.scriptVersion));
        const sourceId = pinned.dataSources.find(
          (s) => s.ref === `tenant-datasource:${row.key}` && s.version === row.version,
        )?.id;
        if (sourceId)
          await this.outbox.record(tx, {
            type: 'verbis.analytics.datasource.executed.v1',
            aggregateType: 'Session',
            aggregateId: sessionId,
            payload: {
              sequence: session.sequence,
              state: session.state,
              eventType: 'datasource.called',
              event: {
                name: row.id,
                status: result.trace.error ? 'failure' : 'success',
                durationMs: Math.min(300000, Math.max(0, Math.round(result.trace.durationMs))),
              },
            },
          });
      }
    });
    if (result.value === undefined) throw new DomainError('VERBIS_INTEGRATION_FAILED');
    return { value: result.value, durationMs: result.trace.durationMs };
  }
  /** Authoring simulation: exact saved pin, explicit TEST profile, server permission and audit. */
  async previewRuntimeCall(
    ref: string,
    version: number,
    call: { input: Record<string, unknown>; environment: 'test' },
  ) {
    const key = ref.replace(/^tenant-datasource:/, '');
    const record = await this.db.current().dataSource.findFirst({
      where: { tenantId: this.db.tenantId(), key, deletedAt: null },
      select: { id: true },
    });
    if (!record) throw new NotFoundError('DataSource');
    const { row, source } = await this.source(record.id, 'execute');
    if (row.version !== version) throw new VersionMismatchError(row.version);
    if (!source.definition.profiles.test)
      throw new ForbiddenError('An explicit test profile is required');
    const result = await this.executor.execute(
      this.db.tenantId(),
      source,
      { input: call.input, environment: 'test' },
      this.reader(row.secretRefs),
      await this.origins(),
    );
    await this.audit.record(this.db.current(), {
      action: 'integration.datasource.previewExecuted',
      target: { type: 'DataSource', id: row.id },
      outcome: result.trace.error ? 'failure' : 'success',
      metadata: { environment: 'test', durationMs: result.trace.durationMs, version },
    });
    if (result.value === undefined) throw new DomainError('VERBIS_INTEGRATION_FAILED');
    return { value: result.value, durationMs: result.trace.durationMs };
  }
  async metrics(id: string) {
    await this.source(id);
    return this.executor.metrics(this.db.tenantId(), id);
  }
  async wsdl(id: string, xml: string) {
    await this.source(id, 'update');
    return importWsdl(xml);
  }
  async introspect(id: string, environment: 'dev' | 'test') {
    const { source, row } = await this.source(id, 'update');
    if (source.protocol !== 'graphql') throw new ForbiddenError();
    const profile = source.definition.profiles[environment];
    const base = new URL(profile?.baseUrl ?? source.definition.baseUrl);
    const url = new URL(source.definition.endpoint, base);
    if (url.origin !== base.origin) throw new ForbiddenError();
    const request = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: introspectionQuery() }),
    };
    const signal = AbortSignal.timeout(source.policy.timeoutMs);
    const origins = await this.origins();
    const applied = await this.executor.authentication.apply(
      this.db.tenantId(),
      profile?.auth ?? source.definition.auth,
      request,
      this.reader(row.secretRefs),
      source.policy,
      origins,
      signal,
    );
    const response = await secureTransport(request, source.policy, origins, signal);
    if (response.status !== 200) throw new DomainError('VERBIS_INTEGRATION_FAILED');
    const result = z
      .object({ data: z.object({ __schema: z.record(z.string(), z.unknown()) }) })
      .parse(JSON.parse(response.body));
    await this.audit.record(this.db.current(), {
      action: 'integration.datasource.introspected',
      target: { type: 'DataSource', id },
    });
    return scrubSecrets(result.data.__schema, applied.secrets);
  }
}
