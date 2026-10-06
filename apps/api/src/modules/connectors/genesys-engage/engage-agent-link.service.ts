import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import { requestContext } from '../../../common/context/request-context.js';
import { ForbiddenError, NotFoundError } from '../../../common/errors/domain-errors.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { RedisService } from '../../../infra/redis/redis.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { IDENTITY_KEYRING } from '../../identity/core/identity.tokens.js';
import { sha256Hex } from '../../identity/crypto/random.js';
import { EnvelopeVault } from '../../integrations/engine/vault.js';
import { INTEGRATION_VAULT } from '../../integrations/integration-engine.service.js';

import {
  CTI_PLATFORM,
  EngageLinkConfigSchema,
  EngageLinkError,
  EngageLinkSchema,
  EngageLinkStateSchema,
  engageAuthorizeUrl,
  exchangeCode,
  LINK_STATE_TTL_SECONDS,
  newState,
  platformUserIdOf,
  refreshTokens,
  withEngageIdentity,
  type EngageLink,
  type EngageLinkConfig,
  type EngageLinkState,
  type EngageLinkStore,
} from './engage-agent-link.js';

import type { Keyring } from '../../identity/crypto/keyring.js';

export const ENGAGE_LINK_STORE = Symbol('ENGAGE_LINK_STORE');
export const ENGAGE_LINK_FETCH = Symbol('ENGAGE_LINK_FETCH');

/** Redis store: sealed values (AAD = key), state GETDEL, per-connector index set. */
export class RedisEngageLinkStore implements EngageLinkStore {
  constructor(
    private readonly redis: RedisService,
    private readonly keyring: Keyring,
  ) {}

  async putState(state: string, value: EngageLinkState, ttlSeconds: number): Promise<void> {
    const key = `ge:state:${sha256Hex(state)}`;
    await this.redis.client.set(
      key,
      this.keyring.seal(JSON.stringify(value), key),
      'EX',
      ttlSeconds,
    );
  }

  async takeState(state: string): Promise<EngageLinkState | undefined> {
    const key = `ge:state:${sha256Hex(state)}`;
    const sealed = await this.redis.client.getdel(key);
    return sealed === null ? undefined : this.#open(EngageLinkStateSchema, sealed, key);
  }

  async putLink(tenantId: string, connectorId: string, link: EngageLink): Promise<void> {
    const key = this.#linkKey(tenantId, connectorId, link.platformUserId);
    const ttl = Math.max(1, Math.ceil((link.expiresAt - Date.now()) / 1_000));
    await this.redis.client
      .multi()
      .set(key, this.keyring.seal(JSON.stringify(link), key), 'EX', ttl)
      .sadd(this.#indexKey(tenantId, connectorId), link.platformUserId)
      .exec();
  }

  async getLink(
    tenantId: string,
    connectorId: string,
    platformUserId: string,
  ): Promise<EngageLink | undefined> {
    const key = this.#linkKey(tenantId, connectorId, platformUserId);
    const sealed = await this.redis.client.get(key);
    return sealed === null ? undefined : this.#open(EngageLinkSchema, sealed, key);
  }

  async deleteLink(tenantId: string, connectorId: string, platformUserId: string): Promise<void> {
    await this.redis.client
      .multi()
      .del(this.#linkKey(tenantId, connectorId, platformUserId))
      .srem(this.#indexKey(tenantId, connectorId), platformUserId)
      .exec();
  }

  async listLinks(tenantId: string, connectorId: string): Promise<string[]> {
    const ids = await this.redis.client.smembers(this.#indexKey(tenantId, connectorId));
    const live: string[] = [];
    for (const id of ids.slice(0, 10_000)) {
      if ((await this.redis.client.exists(this.#linkKey(tenantId, connectorId, id))) === 1)
        live.push(id);
      else await this.redis.client.srem(this.#indexKey(tenantId, connectorId), id);
    }
    return live;
  }

  #linkKey(tenantId: string, connectorId: string, platformUserId: string) {
    return `ge:link:${tenantId}:${connectorId}:${sha256Hex(platformUserId)}`;
  }

  #indexKey(tenantId: string, connectorId: string) {
    return `ge:links:${tenantId}:${connectorId}`;
  }

  #open<T>(schema: z.ZodType<T>, sealed: string, key: string): T | undefined {
    try {
      const parsed = schema.safeParse(JSON.parse(this.keyring.open(sealed, key).toString('utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

export interface EngageLinkStatus {
  readonly connectorId: string;
  readonly linked: boolean;
  readonly expiresAt: string | null;
}

@Injectable()
export class EngageAgentLinkService {
  readonly #store: EngageLinkStore;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(INTEGRATION_VAULT) private readonly vault: EnvelopeVault,
    @Inject(RedisService) redis: RedisService,
    @Inject(IDENTITY_KEYRING) keyring: Keyring,
    @Optional() @Inject(ENGAGE_LINK_STORE) store?: EngageLinkStore,
    @Optional() @Inject(ENGAGE_LINK_FETCH) private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#store = store ?? new RedisEngageLinkStore(redis, keyring);
  }

  // ─── agent (BFF session) ───────────────────────────────────────────────────

  async status(): Promise<EngageLinkStatus[]> {
    const principal = this.#agent();
    const connectors = await this.db.current().connector.findMany({
      where: {
        tenantId: principal.tenantId,
        deletedAt: null,
        adapterType: 'genesys_engage',
        status: 'active',
      },
      select: { id: true, config: true },
      take: 50,
    });
    const user = await this.db.current().user.findFirst({
      where: { id: principal.id, tenantId: principal.tenantId },
      select: { ctiIdentities: true },
    });
    const ids =
      z
        .array(
          z.looseObject({
            platform: z.string(),
            id: z.string(),
            connectorId: z.string().optional(),
          }),
        )
        .safeParse(user?.ctiIdentities).data ?? [];
    const out: EngageLinkStatus[] = [];
    for (const connector of connectors) {
      if (!EngageLinkConfigSchema.safeParse(connector.config).success) continue;
      const identity = ids.find(
        (i) => i.platform === CTI_PLATFORM && i.connectorId === connector.id,
      );
      const link =
        identity === undefined
          ? undefined
          : await this.#store.getLink(principal.tenantId, connector.id, identity.id);
      const mine = link?.userId === principal.id;
      out.push({
        connectorId: connector.id,
        linked: mine,
        expiresAt: mine ? new Date(link.expiresAt).toISOString() : null,
      });
    }
    return out;
  }

  async start(connectorId: string): Promise<string> {
    const principal = this.#agent();
    const { config } = await this.#connector(connectorId);
    const state = newState();
    await this.#store.putState(
      state,
      {
        tenantId: principal.tenantId,
        userId: principal.id,
        sessionId: principal.sessionId ?? '',
        connectorId,
        createdAt: Date.now(),
      },
      LINK_STATE_TTL_SECONDS,
    );
    return engageAuthorizeUrl(config, state);
  }

  async complete(code: string, state: string): Promise<void> {
    const principal = this.#agent();
    const pending = await this.#store.takeState(state);
    if (pending === undefined) throw await this.#deny('state_invalid', 'unknown');
    if (
      pending.tenantId !== principal.tenantId ||
      pending.userId !== principal.id ||
      pending.sessionId !== (principal.sessionId ?? '')
    )
      throw await this.#deny('session_mismatch', pending.connectorId);
    const { config, clientSecret } = await this.#connector(pending.connectorId);
    let tokens;
    let platformUserId: string;
    try {
      tokens = await exchangeCode(this.fetchImpl, config, clientSecret, code, Date.now());
      platformUserId = await platformUserIdOf(this.fetchImpl, config, tokens.accessToken);
    } catch (error) {
      throw await this.#deny(
        error instanceof EngageLinkError ? error.reason : 'exchange_failed',
        pending.connectorId,
      );
    }
    if (tokens.refreshToken === undefined)
      throw await this.#deny('exchange_failed', pending.connectorId);
    const tx = this.db.current();
    const tenantId = principal.tenantId;
    const owners = await tx.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        id: { not: principal.id },
        ctiIdentities: { array_contains: [{ platform: CTI_PLATFORM, id: platformUserId }] },
      },
      select: { id: true },
      take: 1,
    });
    if (owners.length > 0) throw await this.#deny('identity_conflict', pending.connectorId);
    const user = await tx.user.findFirstOrThrow({
      where: { id: principal.id, tenantId, deletedAt: null },
      select: { ctiIdentities: true },
    });
    const linkedAt = new Date().toISOString();
    const next = withEngageIdentity(
      user.ctiIdentities,
      pending.connectorId,
      platformUserId,
      linkedAt,
    );
    await tx.user.update({ where: { id: principal.id }, data: { ctiIdentities: next as never } });
    await this.#store.putLink(tenantId, pending.connectorId, {
      userId: principal.id,
      platformUserId,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.expiresAt,
      linkedAt,
      expiresAt: Date.now() + config.linkTtlHours * 3_600_000,
    });
    await this.audit.record(tx, {
      action: 'user.ctiIdentity.linked',
      target: { type: 'User', id: principal.id },
      before: { ctiIdentities: user.ctiIdentities },
      after: { ctiIdentities: next },
      metadata: {
        platform: CTI_PLATFORM,
        connectorId: pending.connectorId,
        method: 'oauth-authorization-code',
        delegated: true,
      },
    });
  }

  async unlink(connectorId: string): Promise<void> {
    const principal = this.#agent();
    const user = await this.db.current().user.findFirst({
      where: { id: principal.id, tenantId: principal.tenantId },
      select: { ctiIdentities: true },
    });
    const ids =
      z
        .array(
          z.looseObject({
            platform: z.string(),
            id: z.string(),
            connectorId: z.string().optional(),
          }),
        )
        .safeParse(user?.ctiIdentities).data ?? [];
    const identity = ids.find((i) => i.platform === CTI_PLATFORM && i.connectorId === connectorId);
    if (identity === undefined) return;
    await this.#store.deleteLink(principal.tenantId, connectorId, identity.id);
    await this.audit.record(this.db.current(), {
      action: 'connector.agentLink.revoked',
      target: { type: 'Connector', id: connectorId },
      metadata: { platform: CTI_PLATFORM, by: 'agent' },
    });
  }

  // ─── hub (mTLS service principal) ──────────────────────────────────────────

  async linkedAgents(connectorId: string): Promise<{ agents: string[] }> {
    this.#hub();
    await this.#connector(connectorId);
    return { agents: await this.#store.listLinks(this.db.tenantId(), connectorId) };
  }

  /** Short-lived access token for one linked agent's Workspace session; refresh rotates. Audited. */
  async agentToken(
    connectorId: string,
    platformUserId: string,
  ): Promise<{ accessToken: string; expiresAt: string }> {
    this.#hub();
    const tenantId = this.db.tenantId();
    const link = await this.#store.getLink(tenantId, connectorId, platformUserId);
    if (link === undefined) throw new NotFoundError('Agent link');
    let current = link;
    if (link.accessToken === undefined || (link.accessExpiresAt ?? 0) - 60_000 < Date.now()) {
      const { config, clientSecret } = await this.#connector(connectorId);
      try {
        const tokens = await refreshTokens(
          this.fetchImpl,
          config,
          clientSecret,
          link.refreshToken,
          Date.now(),
        );
        current = {
          ...link,
          accessToken: tokens.accessToken,
          accessExpiresAt: tokens.expiresAt,
          refreshToken: tokens.refreshToken ?? link.refreshToken,
        };
        await this.#store.putLink(tenantId, connectorId, current);
      } catch {
        // Revoked at Genesys / expired: drop the link so the hub closes the session.
        await this.#store.deleteLink(tenantId, connectorId, platformUserId);
        throw new NotFoundError('Agent link');
      }
    }
    await this.audit.record(this.db.current(), {
      action: 'connector.agentToken.issued',
      target: { type: 'Connector', id: connectorId },
      metadata: { platform: CTI_PLATFORM, userId: link.userId },
    });
    return {
      accessToken: current.accessToken ?? '',
      expiresAt: new Date(current.accessExpiresAt ?? Date.now()).toISOString(),
    };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  async #connector(
    connectorId: string,
  ): Promise<{ config: EngageLinkConfig; clientSecret: string }> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const connector = await tx.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
        deletedAt: null,
        adapterType: 'genesys_engage',
        status: 'active',
      },
      select: { config: true, secretRefs: true },
    });
    const config = EngageLinkConfigSchema.safeParse(connector?.config);
    if (connector === null || !config.success) throw new EngageLinkError('connector_invalid');
    const ref = config.data.secrets?.['authClientSecret'];
    if (ref === undefined || !connector.secretRefs.includes(ref))
      throw new EngageLinkError('connector_invalid');
    const row = await tx.secret.findFirst({
      where: { id: ref, tenantId, deletedAt: null },
      select: { keyVersion: true, ciphertext: true },
    });
    if (row === null) throw new EngageLinkError('connector_invalid');
    return {
      config: config.data,
      clientSecret: await this.vault.decrypt(tenantId, ref, row.keyVersion, row.ciphertext),
    };
  }

  #agent() {
    const principal = requestContext.get()?.principal;
    if (
      principal?.type !== 'user' ||
      principal.authMethod === 'break_glass' ||
      principal.sessionId === undefined
    )
      throw new EngageLinkError('session_mismatch');
    return principal;
  }

  #hub() {
    const principal = requestContext.get()?.principal;
    if (principal?.type !== 'service' || principal.certificateThumbprint === undefined)
      throw new ForbiddenError('Only the mTLS-authenticated connector hub may call this');
    return principal;
  }

  async #deny(reason: EngageLinkError['reason'], connectorId: string): Promise<EngageLinkError> {
    await this.audit
      .record(this.db.current(), {
        action: 'user.ctiIdentity.linkDenied',
        target: { type: 'Connector', id: connectorId },
        outcome: 'denied',
        reason,
        metadata: { platform: CTI_PLATFORM },
      })
      .catch(() => undefined);
    return new EngageLinkError(reason);
  }
}
