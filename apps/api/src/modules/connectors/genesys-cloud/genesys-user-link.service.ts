import { Inject, Injectable, Optional } from '@nestjs/common';

import { requestContext } from '../../../common/context/request-context.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { RedisService } from '../../../infra/redis/redis.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { IDENTITY_KEYRING } from '../../identity/core/identity.tokens.js';
import { sha256Hex } from '../../identity/crypto/random.js';

import {
  authorizeUrl,
  createPkce,
  CTI_PLATFORM,
  GenesysLinkError,
  LinkStateSchema,
  proveIdentity,
  STATE_TTL_SECONDS,
  UserAuthConfigSchema,
  withGenesysIdentity,
  type LinkState,
  type LinkStateStore,
} from './genesys-user-link.js';

import type { Keyring } from '../../identity/crypto/keyring.js';

export const GENESYS_LINK_FETCH = Symbol('GENESYS_LINK_FETCH');
export const GENESYS_LINK_STATES = Symbol('GENESYS_LINK_STATES');

/** Redis state store: sealed value, key = sha256(state), atomic GETDEL (single use). */
export class RedisLinkStateStore implements LinkStateStore {
  constructor(
    private readonly redis: RedisService,
    private readonly keyring: Keyring,
  ) {}

  async put(state: string, value: LinkState, ttlSeconds: number): Promise<void> {
    const key = `gc:link:${sha256Hex(state)}`;
    await this.redis.client.set(
      key,
      this.keyring.seal(JSON.stringify(value), key),
      'EX',
      ttlSeconds,
    );
  }

  async take(state: string): Promise<LinkState | undefined> {
    const key = `gc:link:${sha256Hex(state)}`;
    const sealed = await this.redis.client.getdel(key);
    if (sealed === null) return undefined;
    try {
      const parsed = LinkStateSchema.safeParse(
        JSON.parse(this.keyring.open(sealed, key).toString('utf8')),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

@Injectable()
export class GenesysUserLinkService {
  readonly #states: LinkStateStore;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisService) redis: RedisService,
    @Inject(IDENTITY_KEYRING) keyring: Keyring,
    @Optional() @Inject(GENESYS_LINK_STATES) states?: LinkStateStore,
    @Optional() @Inject(GENESYS_LINK_FETCH) private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#states = states ?? new RedisLinkStateStore(redis, keyring);
  }

  /** Starts the grant for the signed-in agent; returns the Genesys authorize URL. */
  async start(connectorId: string): Promise<string> {
    const principal = this.#agent();
    const config = await this.#config(connectorId);
    const pkce = createPkce();
    await this.#states.put(
      pkce.state,
      {
        tenantId: principal.tenantId,
        userId: principal.id,
        sessionId: principal.sessionId ?? '',
        connectorId,
        codeVerifier: pkce.verifier,
        createdAt: new Date().getTime(),
      },
      STATE_TTL_SECONDS,
    );
    return authorizeUrl(
      config.region,
      config.userAuth.clientId,
      config.userAuth.redirectUri,
      pkce.state,
      pkce.challenge,
    );
  }

  /** Completes the grant; links the proven Genesys user id. Every outcome is audited. */
  async complete(code: string, state: string): Promise<{ redirectUri: string }> {
    const principal = this.#agent();
    const link = await this.#states.take(state);
    if (link === undefined) throw await this.#deny('state_invalid', 'unknown');
    if (
      link.tenantId !== principal.tenantId ||
      link.userId !== principal.id ||
      link.sessionId !== (principal.sessionId ?? '')
    )
      throw await this.#deny('session_mismatch', link.connectorId);
    const config = await this.#config(link.connectorId);
    let proven;
    try {
      proven = await proveIdentity(config, code, link.codeVerifier, this.fetchImpl);
    } catch (error) {
      throw await this.#deny(
        error instanceof GenesysLinkError ? error.reason : 'exchange_failed',
        link.connectorId,
      );
    }
    const tx = this.db.current();
    const tenantId = principal.tenantId;
    // One Genesys user ↔ one Verbis user: ambiguity would map launches to nobody (user-mapping.ts).
    const owners = await tx.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        id: { not: principal.id },
        ctiIdentities: { array_contains: [{ platform: CTI_PLATFORM, id: proven.genesysUserId }] },
      },
      select: { id: true },
      take: 1,
    });
    if (owners.length > 0) throw await this.#deny('identity_conflict', link.connectorId);
    const user = await tx.user.findFirstOrThrow({
      where: { id: principal.id, tenantId, deletedAt: null },
      select: { ctiIdentities: true },
    });
    const next = withGenesysIdentity(
      user.ctiIdentities,
      link.connectorId,
      proven.genesysUserId,
      new Date().toISOString(),
    );
    await tx.user.update({ where: { id: principal.id }, data: { ctiIdentities: next as never } });
    await this.audit.record(tx, {
      action: 'user.ctiIdentity.linked',
      target: { type: 'User', id: principal.id },
      before: { ctiIdentities: user.ctiIdentities },
      after: { ctiIdentities: next },
      metadata: { platform: CTI_PLATFORM, connectorId: link.connectorId, method: 'oauth-pkce' },
    });
    return { redirectUri: config.userAuth.redirectUri };
  }

  async #config(connectorId: string) {
    const connector = await this.db.current().connector.findFirst({
      where: {
        id: connectorId,
        tenantId: this.db.tenantId(),
        deletedAt: null,
        adapterType: 'genesys_cloud',
        status: 'active',
      },
      select: { config: true },
    });
    const parsed = UserAuthConfigSchema.safeParse(connector?.config);
    if (!parsed.success) throw new GenesysLinkError('connector_invalid');
    return parsed.data;
  }

  #agent() {
    const principal = requestContext.get()?.principal;
    if (
      principal?.type !== 'user' ||
      principal.authMethod === 'break_glass' ||
      principal.sessionId === undefined
    )
      throw new GenesysLinkError('session_mismatch');
    return principal;
  }

  async #deny(reason: GenesysLinkError['reason'], connectorId: string): Promise<GenesysLinkError> {
    await this.audit
      .record(this.db.current(), {
        action: 'user.ctiIdentity.linkDenied',
        target: { type: 'Connector', id: connectorId },
        outcome: 'denied',
        reason,
        metadata: { platform: CTI_PLATFORM },
      })
      .catch(() => undefined);
    return new GenesysLinkError(reason);
  }
}
