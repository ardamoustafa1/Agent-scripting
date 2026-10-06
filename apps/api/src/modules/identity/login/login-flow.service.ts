import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainError } from '../../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { AppOrigins, safeReturnPath } from '../core/app-origins.js';
import { IdentitySecrets } from '../core/identity-secrets.js';
import { identityActor, IdentityTx } from '../core/identity-tx.js';
import { APP_ORIGINS, SESSION_STORE } from '../core/identity.tokens.js';
import { TenantResolver, type ResolvedTenant } from '../core/tenant-resolver.js';
import { randomToken, sha256Hex } from '../crypto/random.js';
import { DomainSchema, oidcClaimNames, samlNameIdFormat } from '../idp/idp-config.js';
import { OIDC_PRESETS } from '../idp/idp-presets.js';
import {
  IdpRepository,
  type LoadedIdp,
  type OidcIdp,
  type SamlIdp,
} from '../idp/idp.repository.js';
import { claimStrings, claimValue } from '../idp/role-mapping.js';
import { OidcLoginError, OidcService } from '../oidc/oidc.service.js';
import {
  SamlLoginError,
  SamlService,
  usableCredentials,
  type SamlEndpoints,
  type SamlKeys,
} from '../saml/saml.service.js';
import { buildSpMetadata } from '../saml/sp-metadata.js';
import { SessionService } from '../session/session.service.js';

import {
  LOGIN_TRANSACTION_TTL_SECONDS,
  LoginTransactions,
  type LoginTransaction,
} from './login-transaction.js';
import {
  LoginFailedError,
  LoginRejectedError,
  LoginService,
  type LoginFailureReason,
} from './login.service.js';

import type { SessionStore } from '../session/session-store.js';
import type { SessionRecord } from '../session/session.types.js';

export interface DiscoveredProvider {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: 'oidc' | 'saml';
}

export interface DiscoveryResult {
  readonly tenant: string;
  readonly providers: readonly DiscoveredProvider[];
}

export interface BrowserContext {
  readonly ip: string;
  readonly userAgent: string;
  /** Value of the login-transaction cookie, if the browser sent one. */
  readonly transactionCookie?: string;
}

export interface LoginOutcome {
  readonly redirectUrl: string;
  readonly session?: { readonly token: string; readonly maxAgeSeconds: number };
}

/** Problem slugs shown to the user after a failed browser login (no internals). */
const FAILURE_CODES: Partial<Record<LoginFailureReason, string>> = {
  user_not_provisioned: 'not_provisioned',
  user_inactive: 'inactive',
  session_limit: 'session_limit',
};

/**
 * Browser SSO orchestration (OIDC and SAML): home-realm discovery, login start, callbacks,
 * logout (RP-initiated, back-channel, front-channel, SAML SLO) and SP metadata. Every outcome is
 * audited through LoginService/SessionService.
 */
@Injectable()
export class LoginFlowService {
  readonly #logger = new Logger(LoginFlowService.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(APP_ORIGINS) private readonly origins: AppOrigins,
    @Inject(TenantResolver) private readonly tenants: TenantResolver,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(IdpRepository) private readonly idps: IdpRepository,
    @Inject(IdentitySecrets) private readonly secrets: IdentitySecrets,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(SamlService) private readonly saml: SamlService,
    @Inject(LoginService) private readonly login: LoginService,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(LoginTransactions) private readonly transactions: LoginTransactions,
  ) {}

  // ─── Discovery ──────────────────────────────────────────────────────────────

  /** Home-realm discovery by email domain or tenant slug. Unknown input yields no providers. */
  async discover(input: { email?: string; tenant?: string }): Promise<DiscoveryResult | undefined> {
    if (input.email !== undefined) {
      const domain = DomainSchema.safeParse(input.email.split('@').pop() ?? '');
      if (!domain.success) return undefined;
      const realms = await this.tenants.byEmailDomain(domain.data);
      const realm = realms[0];
      if (realm === undefined) return undefined;
      const providers = await this.providers(realm.tenantId);
      return {
        tenant: realm.tenantSlug,
        providers: providers.filter((p) => realms.some((r) => r.idpId === p.id)),
      };
    }
    if (input.tenant === undefined) return undefined;
    const tenant = await this.tenants.bySlug(input.tenant);
    if (tenant?.status !== 'active') return undefined;
    return { tenant: tenant.slug, providers: await this.providers(tenant.id) };
  }

  private async providers(tenantId: string): Promise<DiscoveredProvider[]> {
    const idps = await this.identityTx.run(tenantId, identityActor(tenantId), (tx) =>
      this.idps.listActive(tx, tenantId),
    );
    return idps.map((idp) => ({
      id: idp.id,
      displayName: idp.displayName,
      protocol: idp.protocol,
    }));
  }

  // ─── Login start ────────────────────────────────────────────────────────────

  async start(input: {
    tenant: string;
    idpId?: string;
    app: string;
    returnTo?: string;
    transactionCookie: string;
  }): Promise<string> {
    const tenant = await this.activeTenant(input.tenant);
    if (!this.origins.has(input.app))
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'Unknown app');
    const idp = await this.identityTx.run(tenant.id, identityActor(tenant.id), async (tx) => {
      if (input.idpId !== undefined) return this.idps.findActive(tx, tenant.id, input.idpId);
      const all = await this.idps.listActive(tx, tenant.id);
      return all.length === 1 ? all[0] : undefined;
    });
    if (idp === undefined) throw new DomainError('VERBIS_AUTH_TENANT_UNKNOWN');
    const base = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      idpId: idp.id,
      app: input.app,
      returnTo: safeReturnPath(input.returnTo),
      browserBinding: sha256Hex(input.transactionCookie),
      createdAt: Date.now(),
    };
    if (idp.protocol === 'oidc') {
      const { secret } = await this.loadOidcSecret(idp);
      const config = await this.oidc.configuration(idp, secret);
      const callbackUrl = this.requireUrl(input.app, tenant.slug, '/auth/oidc/callback');
      const state = randomToken(32);
      const request = await this.oidc.authorizationRequest(idp, config, callbackUrl, state);
      await this.transactions.put(
        {
          ...base,
          protocol: 'oidc',
          callbackUrl,
          oidc: { state, nonce: request.nonce, codeVerifier: request.codeVerifier },
        },
        state,
      );
      return request.url;
    }
    const keys = await this.loadSamlKeys(idp);
    const endpoints = this.samlEndpoints(idp, tenant.slug, input.app);
    const relayState = randomToken(32);
    const request = await this.saml.authnRequestUrl(idp, keys, endpoints, relayState);
    await this.transactions.put(
      {
        ...base,
        protocol: 'saml',
        callbackUrl: endpoints.acsUrl,
        saml: { requestId: request.requestId },
      },
      relayState,
    );
    return request.url;
  }

  // ─── OIDC callback ──────────────────────────────────────────────────────────

  async oidcCallback(
    query: Record<string, string>,
    rawQuery: string,
    browser: BrowserContext,
  ): Promise<LoginOutcome> {
    const transaction = await this.transactions.take(query['state']);
    if (transaction?.protocol !== 'oidc' || transaction.oidc === undefined) {
      throw new DomainError(
        'VERBIS_AUTH_LOGIN_FAILED',
        'The sign-in request expired or was already used',
      );
    }
    const fail = (reason: LoginFailureReason) => this.failed(transaction, reason);
    if (!this.boundToBrowser(transaction, browser)) return fail('transaction_invalid');
    const idp = await this.loadIdp(transaction);
    if (idp?.protocol !== 'oidc') return fail('idp_inactive');
    let tokens: Awaited<ReturnType<OidcService['redeem']>>;
    try {
      const { secret } = await this.loadOidcSecret(idp);
      const config = await this.oidc.configuration(idp, secret);
      tokens = await this.oidc.redeem(
        config,
        new URL(`${transaction.callbackUrl}?${rawQuery}`),
        transaction.oidc,
      );
    } catch (error) {
      if (error instanceof OidcLoginError || error instanceof DomainError) {
        this.#logger.warn(
          `OIDC callback rejected (${error instanceof OidcLoginError ? error.reason : error.code})`,
        );
        return fail('protocol_error');
      }
      throw error;
    }
    const names = oidcClaimNames(idp.config);
    const first = (path: string | undefined) =>
      path === undefined ? undefined : claimStrings(claimValue(tokens.claims, path))[0];
    const verifiedRaw =
      names.emailVerified === undefined
        ? undefined
        : claimValue(tokens.claims, names.emailVerified);
    const emailVerified = OIDC_PRESETS[idp.config.vendor].emailVerifiedClaim
      ? verifiedRaw === true || verifiedRaw === 'true'
      : verifiedRaw === true;
    const email = first(names.email);
    const displayName = first(names.displayName);
    const locale = first(names.locale);
    return this.finish(transaction, idp, browser, {
      identity: {
        subject: tokens.subject,
        ...(email === undefined ? {} : { email }),
        emailVerified,
        ...(displayName === undefined ? {} : { displayName }),
        ...(locale === undefined ? {} : { locale }),
        claims: tokens.claims,
      },
      protocolData: {
        oidc: {
          sub: tokens.subject,
          ...(tokens.sid === undefined ? {} : { sid: tokens.sid }),
          ...(tokens.idToken === undefined ? {} : { idToken: tokens.idToken }),
          ...(tokens.accessToken === undefined ? {} : { accessToken: tokens.accessToken }),
          ...(tokens.accessTokenExpiresAt === undefined
            ? {}
            : { accessTokenExpiresAt: tokens.accessTokenExpiresAt }),
          ...(tokens.refreshToken === undefined ? {} : { refreshToken: tokens.refreshToken }),
        },
        ...(tokens.amr === undefined ? {} : { amr: tokens.amr }),
        ...(tokens.acr === undefined ? {} : { acr: tokens.acr }),
      },
    });
  }

  // ─── SAML ACS ───────────────────────────────────────────────────────────────

  async samlAcs(
    slug: string,
    idpId: string,
    body: Record<string, unknown>,
    browser: BrowserContext,
  ): Promise<LoginOutcome> {
    const tenant = await this.activeTenant(slug);
    const relayState = typeof body['RelayState'] === 'string' ? body['RelayState'] : undefined;
    const taken = await this.transactions.take(relayState);
    const solicitedTx =
      taken?.protocol === 'saml' && taken.idpId === idpId && taken.tenantId === tenant.id
        ? taken
        : undefined;
    const solicited = solicitedTx !== undefined;
    const idp = await this.identityTx.run(tenant.id, identityActor(tenant.id), (tx) =>
      this.idps.findActive(tx, tenant.id, idpId),
    );
    if (idp?.protocol !== 'saml') throw new DomainError('VERBIS_AUTH_LOGIN_FAILED');
    // Unsolicited (IdP-initiated) response: a RelayState naming an app may pick where to land.
    const app =
      solicitedTx !== undefined
        ? solicitedTx.app
        : relayState !== undefined && this.origins.has(relayState)
          ? relayState
          : this.defaultApp();
    const transaction: LoginTransaction = solicitedTx ?? {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      idpId,
      protocol: 'saml',
      app,
      returnTo: '/',
      callbackUrl: this.requireUrl(app, tenant.slug, `/auth/saml/${tenant.slug}/${idpId}/acs`),
      browserBinding: '',
      createdAt: Date.now(),
    };
    if (solicited && !this.boundToBrowser(transaction, browser))
      return this.failed(transaction, 'transaction_invalid');
    if (!solicited && !idp.config.allowIdpInitiated)
      return this.failed(transaction, 'unsolicited_response');

    let assertion: Awaited<ReturnType<SamlService['validateResponse']>>;
    try {
      const keys = await this.loadSamlKeys(idp);
      assertion = await this.saml.validateResponse(
        idp,
        keys,
        this.samlEndpoints(idp, tenant.slug, transaction.app),
        body,
        solicited ? transaction.saml?.requestId : undefined,
      );
    } catch (error) {
      if (error instanceof SamlLoginError) {
        this.#logger.warn(`SAML response rejected (${error.reason})`);
        return this.failed(
          transaction,
          error.reason === 'unsolicited_response' ? 'unsolicited_response' : 'protocol_error',
        );
      }
      throw error;
    }
    const ttl =
      assertion.notOnOrAfter === undefined
        ? 3600
        : Math.ceil((assertion.notOnOrAfter.getTime() - Date.now()) / 1000) + 300;
    if (
      !(await this.transactions.markOnce(
        'saml-assertion',
        `${idpId}:${assertion.assertionId}`,
        ttl,
      ))
    ) {
      return this.failed(transaction, 'replay');
    }
    return this.finish(transaction, idp, browser, {
      identity: assertion.identity,
      protocolData: {
        saml: {
          nameId: assertion.nameId,
          nameIdFormat: assertion.nameIdFormat,
          ...(assertion.sessionIndex === undefined ? {} : { sessionIndex: assertion.sessionIndex }),
          ...(assertion.nameQualifier === undefined
            ? {}
            : { nameQualifier: assertion.nameQualifier }),
          ...(assertion.spNameQualifier === undefined
            ? {}
            : { spNameQualifier: assertion.spNameQualifier }),
        },
      },
    });
  }

  async spMetadata(slug: string, idpId: string): Promise<string> {
    const tenant = await this.activeTenant(slug);
    const idp = await this.identityTx.run(tenant.id, identityActor(tenant.id), (tx) =>
      this.idps.find(tx, tenant.id, idpId),
    );
    if (idp?.protocol !== 'saml')
      throw new DomainError('VERBIS_RESOURCE_NOT_FOUND', 'Identity provider not found');
    const published = idp.config.spCredentials.filter((c) => c.state !== 'retired');
    const apps = this.origins.apps();
    return buildSpMetadata({
      entityId: this.samlEntityId(slug, idpId),
      acsUrls: apps.map((app) => this.requireUrl(app, slug, `/auth/saml/${slug}/${idpId}/acs`)),
      sloUrls: apps
        .slice(0, 1)
        .map((app) => this.requireUrl(app, slug, `/auth/saml/${slug}/${idpId}/slo`)),
      nameIdFormat: samlNameIdFormat(idp.config),
      signingCertificates: published.filter((c) => c.use === 'signing').map((c) => c.certificate),
      encryptionCertificates: published
        .filter((c) => c.use === 'encryption')
        .map((c) => c.certificate),
      authnRequestsSigned: idp.config.signRequests,
      validUntil: new Date(Date.now() + 7 * 86_400_000),
    });
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  /** RP-initiated logout: ends the Verbis session, returns where the browser should go next. */
  async logout(hash: string, record: SessionRecord): Promise<{ redirectUrl: string }> {
    const slug = await this.slugOf(record.tenantId);
    const appOrigin = this.origins.originFor(record.app, slug) ?? this.env.PUBLIC_API_URL;
    await this.store.revokeHash(hash);
    await this.sessionService.recordEndedInRequest([record], 'logout');
    if (record.idpId === undefined) return { redirectUrl: `${appOrigin}/` };
    try {
      const idpId = record.idpId;
      const idp = await this.identityTx.run(record.tenantId, identityActor(record.tenantId), (tx) =>
        this.idps.findActive(tx, record.tenantId, idpId),
      );
      if (idp?.protocol === 'oidc' && record.oidc !== undefined) {
        const { secret } = await this.loadOidcSecret(idp);
        const config = await this.oidc.configuration(idp, secret);
        const url = this.oidc.endSessionUrl(config, record.oidc.idToken, `${appOrigin}/`);
        return { redirectUrl: url ?? `${appOrigin}/` };
      }
      if (idp?.protocol === 'saml' && record.saml !== undefined) {
        const keys = await this.loadSamlKeys(idp);
        const url = await this.saml.logoutRequestUrl(
          idp,
          keys,
          this.samlEndpoints(idp, slug, record.app),
          record.saml,
          record.app,
        );
        return { redirectUrl: url ?? `${appOrigin}/` };
      }
    } catch (error) {
      // The Verbis session is already gone; IdP logout is best effort.
      this.#logger.warn(
        `IdP logout URL unavailable (${error instanceof Error ? error.name : 'error'})`,
      );
    }
    return { redirectUrl: `${appOrigin}/` };
  }

  /** OIDC Back-Channel Logout 1.0: the IdP posts a signed logout token. */
  async backchannelLogout(slug: string, idpId: string, logoutToken: unknown): Promise<void> {
    if (typeof logoutToken !== 'string' || logoutToken.length > 16_384)
      throw new OidcLoginError('logout_token_missing');
    const tenant = await this.activeTenant(slug);
    const idp = await this.identityTx.run(tenant.id, identityActor(tenant.id), (tx) =>
      this.idps.findActive(tx, tenant.id, idpId),
    );
    if (idp?.protocol !== 'oidc') throw new OidcLoginError('unknown_idp');
    const { secret } = await this.loadOidcSecret(idp);
    const config = await this.oidc.configuration(idp, secret);
    const claims = await this.oidc.verifyLogoutToken(idp, config, logoutToken);
    if (
      !(await this.transactions.markOnce(
        'logout-jti',
        `${idpId}:${claims.jti}`,
        claims.exp - Math.floor(Date.now() / 1000) + 600,
      ))
    ) {
      throw new OidcLoginError('logout_token_replayed');
    }
    const revoked =
      claims.sid !== undefined
        ? await this.store.revokeByOidcSid(tenant.id, idpId, claims.sid)
        : await this.store.revokeByOidcSubject(tenant.id, idpId, claims.sub ?? '');
    await this.sessionService.recordEnded(
      tenant.id,
      identityActor(tenant.id),
      revoked,
      'backchannel',
    );
  }

  /** OIDC Front-Channel Logout 1.0: rendered by the IdP in an iframe with `iss` and `sid`. */
  async frontchannelLogout(
    slug: string,
    idpId: string,
    iss: string | undefined,
    sid: string | undefined,
  ): Promise<string | undefined> {
    const tenant = await this.activeTenant(slug);
    const idp = await this.identityTx.run(tenant.id, identityActor(tenant.id), (tx) =>
      this.idps.findActive(tx, tenant.id, idpId),
    );
    if (idp?.protocol !== 'oidc' || sid === undefined || sid.length > 512) return undefined;
    const { secret } = await this.loadOidcSecret(idp);
    const config = await this.oidc.configuration(idp, secret);
    if (iss !== this.oidc.issuer(config)) return undefined;
    const revoked = await this.store.revokeByOidcSid(tenant.id, idpId, sid);
    await this.sessionService.recordEnded(
      tenant.id,
      identityActor(tenant.id),
      revoked,
      'frontchannel',
    );
    return new URL(this.oidc.issuer(config)).origin;
  }

  /** SAML SLO endpoint (HTTP-Redirect or HTTP-POST binding). */
  async samlSlo(
    slug: string,
    idpId: string,
    message: Parameters<SamlService['handleSloMessage']>[3],
  ): Promise<string> {
    const tenant = await this.activeTenant(slug);
    const idp = await this.identityTx.run(tenant.id, identityActor(tenant.id), (tx) =>
      this.idps.findActive(tx, tenant.id, idpId),
    );
    if (idp?.protocol !== 'saml')
      throw new DomainError('VERBIS_RESOURCE_NOT_FOUND', 'Identity provider not found');
    const keys = await this.loadSamlKeys(idp);
    const relay =
      message.method === 'GET' ? message.query['RelayState'] : message.body['RelayState'];
    const app = relay !== undefined && this.origins.has(relay) ? relay : this.defaultApp();
    let result: Awaited<ReturnType<SamlService['handleSloMessage']>>;
    try {
      result = await this.saml.handleSloMessage(
        idp,
        keys,
        this.samlEndpoints(idp, tenant.slug, app),
        message,
      );
    } catch (error) {
      if (error instanceof SamlLoginError)
        throw new DomainError('VERBIS_VALIDATION_FAILED', 'Invalid SAML logout message');
      throw error;
    }
    if (result.kind === 'response') return `${this.origins.originFor(app, tenant.slug) ?? ''}/`;
    const revoked = await this.store.revokeBySaml(
      tenant.id,
      idpId,
      result.nameId,
      result.sessionIndexes,
    );
    await this.sessionService.recordEnded(tenant.id, identityActor(tenant.id), revoked, 'saml_slo');
    return result.responseUrl;
  }

  tenantFromHost(host: string | undefined, scheme: 'http' | 'https'): string | undefined {
    return this.origins.tenantFromHost(host, scheme);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async finish(
    transaction: LoginTransaction,
    idp: LoadedIdp,
    browser: BrowserContext,
    data: {
      identity: Parameters<LoginService['completeSsoLogin']>[1];
      protocolData: Parameters<LoginService['completeSsoLogin']>[2]['protocolData'];
    },
  ): Promise<LoginOutcome> {
    const appOrigin = this.origins.originFor(transaction.app, transaction.tenantSlug) ?? '';
    try {
      const created = await this.login.completeSsoLogin(idp, data.identity, {
        app: transaction.app,
        ip: browser.ip,
        userAgent: browser.userAgent,
        protocolData: data.protocolData,
      });
      return {
        redirectUrl: `${appOrigin}${transaction.returnTo}`,
        session: {
          token: created.token,
          maxAgeSeconds: Math.floor(
            (created.record.absoluteExpiresAt - created.record.createdAt) / 1000,
          ),
        },
      };
    } catch (error) {
      if (error instanceof LoginFailedError) {
        return {
          redirectUrl: `${appOrigin}/?authError=${FAILURE_CODES[error.reason] ?? 'login_failed'}`,
        };
      }
      if (error instanceof LoginRejectedError) return this.failed(transaction, error.reason);
      throw error;
    }
  }

  private async failed(
    transaction: LoginTransaction,
    reason: LoginFailureReason,
  ): Promise<LoginOutcome> {
    await this.login.recordFailure(
      { id: transaction.idpId, tenantId: transaction.tenantId, protocol: transaction.protocol },
      reason,
    );
    const appOrigin = this.origins.originFor(transaction.app, transaction.tenantSlug) ?? '';
    return { redirectUrl: `${appOrigin}/?authError=${FAILURE_CODES[reason] ?? 'login_failed'}` };
  }

  private boundToBrowser(transaction: LoginTransaction, browser: BrowserContext): boolean {
    return (
      browser.transactionCookie !== undefined &&
      transaction.browserBinding !== '' &&
      sha256Hex(browser.transactionCookie) === transaction.browserBinding &&
      Date.now() - transaction.createdAt < LOGIN_TRANSACTION_TTL_SECONDS * 1000
    );
  }

  private async activeTenant(slug: string): Promise<ResolvedTenant> {
    const tenant = await this.tenants.bySlug(slug);
    if (tenant?.status !== 'active') throw new DomainError('VERBIS_AUTH_TENANT_UNKNOWN');
    return tenant;
  }

  private async slugOf(tenantId: string): Promise<string> {
    const row = await this.identityTx.run(tenantId, identityActor(tenantId), (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { slug: true } }),
    );
    return row?.slug ?? '';
  }

  private loadIdp(transaction: LoginTransaction): Promise<LoadedIdp | undefined> {
    return this.identityTx.run(transaction.tenantId, identityActor(transaction.tenantId), (tx) =>
      this.idps.findActive(tx, transaction.tenantId, transaction.idpId),
    );
  }

  private async loadOidcSecret(idp: OidcIdp): Promise<{ secret: string }> {
    const ref = idp.config.clientSecretRef;
    const secret =
      ref === undefined
        ? undefined
        : await this.identityTx.run(idp.tenantId, identityActor(idp.tenantId), (tx) =>
            this.secrets.reveal(tx, idp.tenantId, ref),
          );
    if (secret === undefined)
      throw new DomainError('VERBIS_IDENTITY_IDP_CONFIG_INVALID', 'The client secret is not set');
    return { secret };
  }

  private async loadSamlKeys(idp: SamlIdp): Promise<SamlKeys> {
    const usable = usableCredentials(idp.config.spCredentials);
    return this.identityTx.run(idp.tenantId, identityActor(idp.tenantId), async (tx) => {
      const signingKey =
        usable.signing === undefined
          ? undefined
          : await this.secrets.reveal(tx, idp.tenantId, usable.signing.privateKeyRef);
      const decryptionKeys: string[] = [];
      for (const credential of usable.encryption) {
        const key = await this.secrets.reveal(tx, idp.tenantId, credential.privateKeyRef);
        if (key !== undefined) decryptionKeys.push(key);
      }
      return { ...(signingKey === undefined ? {} : { signingKey }), decryptionKeys };
    });
  }

  samlEntityId(slug: string, idpId: string): string {
    return `${this.env.PUBLIC_API_URL}/auth/saml/${slug}/${idpId}`;
  }

  private samlEndpoints(idp: SamlIdp, slug: string, app: string): SamlEndpoints {
    return {
      entityId: this.samlEntityId(slug, idp.id),
      acsUrl: this.requireUrl(app, slug, `/auth/saml/${slug}/${idp.id}/acs`),
      sloUrl: this.requireUrl(app, slug, `/auth/saml/${slug}/${idp.id}/slo`),
    };
  }

  private requireUrl(app: string, slug: string, path: string): string {
    const url = this.origins.publicUrl(app, slug, path);
    if (url === undefined) throw new DomainError('VERBIS_VALIDATION_FAILED', 'Unknown app');
    return url;
  }

  private defaultApp(): string {
    return this.origins.has('agent') ? 'agent' : (this.origins.apps()[0] ?? 'agent');
  }
}
