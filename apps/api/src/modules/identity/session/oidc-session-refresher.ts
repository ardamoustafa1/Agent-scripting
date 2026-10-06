import { Inject, Injectable, Logger } from '@nestjs/common';

import { type ApiEnv, API_ENV } from '../../../env.js';
import { IdentitySecrets } from '../core/identity-secrets.js';
import { identityActor, IdentityTx } from '../core/identity-tx.js';
import { IDENTITY_CLOCK, SESSION_STORE, type Clock } from '../core/identity.tokens.js';
import { IdpRepository, type OidcIdp } from '../idp/idp.repository.js';
import { OidcService } from '../oidc/oidc.service.js';

import type { SessionStore } from './session-store.js';
import type { SessionRecord } from './session.types.js';

/** Refresh shortly before expiry so in-flight requests do not race the IdP's clock. */
const REFRESH_LEEWAY_MS = 30_000;

/**
 * Keeps OIDC sessions aligned with the IdP: when the IdP access token expires, the refresh token
 * is redeemed (rotation). A refused refresh means the IdP session ended or the token was
 * revoked/reused, so the Verbis session ends too. If the IdP is merely unreachable the session
 * continues (until its own idle/absolute timeout) and the refresh is retried on the next request.
 */
@Injectable()
export class OidcSessionRefresher {
  readonly #logger = new Logger(OidcSessionRefresher.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(IdpRepository) private readonly idps: IdpRepository,
    @Inject(IdentitySecrets) private readonly secrets: IdentitySecrets,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(IDENTITY_CLOCK) private readonly now: Clock,
  ) {}

  /** Returns the (possibly refreshed) record, or undefined when the session was ended. */
  async ensureFresh(hash: string, record: SessionRecord): Promise<SessionRecord | undefined> {
    const tokens = record.oidc;
    if (
      !this.env.OIDC_REFRESH_ON_EXPIRY ||
      record.protocol !== 'oidc' ||
      record.idpId === undefined ||
      tokens?.refreshToken === undefined ||
      tokens.accessTokenExpiresAt === undefined ||
      tokens.accessTokenExpiresAt - REFRESH_LEEWAY_MS > this.now()
    ) {
      return record;
    }
    // One refresh per session at a time: a rotated refresh token is single-use.
    const release = await this.store.tryLock(`refresh:${hash}`, 10_000);
    if (release === undefined) return record;
    try {
      const idpId = record.idpId;
      const loaded = await this.identityTx.run(
        record.tenantId,
        identityActor(record.tenantId),
        async (tx) => {
          const idp = await this.idps.findActive(tx, record.tenantId, idpId);
          if (idp?.protocol !== 'oidc' || idp.config.clientSecretRef === undefined)
            return undefined;
          const secret = await this.secrets.reveal(tx, record.tenantId, idp.config.clientSecretRef);
          return secret === undefined ? undefined : { idp, secret };
        },
      );
      if (loaded === undefined) {
        await this.store.revokeHash(hash);
        return undefined;
      }
      const outcome = await this.refresh(
        loaded.idp,
        loaded.secret,
        tokens.refreshToken,
        tokens.sub,
      );
      if (outcome === 'unavailable') return record;
      if (outcome === 'revoked') {
        await this.store.revokeHash(hash);
        return undefined;
      }
      const updated: SessionRecord = {
        ...record,
        oidc: { ...tokens, ...outcome, refreshedAt: this.now() },
      };
      await this.store.update(hash, updated);
      return updated;
    } finally {
      await release();
    }
  }

  private async refresh(idp: OidcIdp, secret: string, refreshToken: string, sub: string) {
    try {
      const config = await this.oidc.configuration(idp, secret);
      const result = await this.oidc.refresh(config, refreshToken, sub);
      if (result.kind === 'refreshed') return result.tokens;
      return result.kind;
    } catch {
      this.#logger.warn('OIDC refresh failed (IdP unavailable)');
      return 'unavailable' as const;
    }
  }
}
