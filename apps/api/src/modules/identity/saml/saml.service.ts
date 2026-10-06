import { inflateRawSync } from 'node:zlib';

import { Inject, Injectable } from '@nestjs/common';
import { SAML, type CacheProvider, type Profile, ValidateInResponseTo } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';

import { type ApiEnv, API_ENV } from '../../../env.js';
import { RedisService } from '../../../infra/redis/redis.service.js';
import { samlAttributeNames, samlNameIdFormat, type SpCredential } from '../idp/idp-config.js';
import { claimStrings } from '../idp/role-mapping.js';

import type { SamlIdp } from '../idp/idp.repository.js';
import type { ExternalIdentity } from '../login/login.service.js';

export interface SamlKeys {
  /** PEM private key of the active signing credential. */
  readonly signingKey?: string;
  /** PEM private keys of active and retired encryption credentials (tried in order). */
  readonly decryptionKeys: readonly string[];
}

export interface SamlEndpoints {
  readonly entityId: string;
  readonly acsUrl: string;
  readonly sloUrl: string;
}

export class SamlLoginError extends Error {
  override readonly name = 'SamlLoginError';
  constructor(readonly reason: string) {
    super(reason);
  }
}

export interface ValidatedAssertion {
  readonly identity: ExternalIdentity;
  readonly nameId: string;
  readonly nameIdFormat: string;
  readonly sessionIndex?: string;
  readonly nameQualifier?: string;
  readonly spNameQualifier?: string;
  readonly inResponseTo?: string;
  readonly assertionId: string;
  readonly notOnOrAfter?: Date;
}

const TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';
const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const REQUEST_TTL_SECONDS = 600;

/**
 * InResponseTo store: AuthnRequest ids live in Redis for 10 minutes, shared by all replicas.
 * node-saml removes an id even when validation fails, which would break the retry with a rotated
 * decryption key; ids are therefore removed by SamlService after a successful validation only.
 * Single use is guaranteed independently by the login transaction (GETDEL) and the assertion-id
 * replay cache.
 */
class RedisCacheProvider implements CacheProvider {
  constructor(private readonly redis: RedisService['client']) {}
  async saveAsync(key: string, value: string) {
    await this.redis.set(`idn:saml:req:${key}`, value, 'EX', REQUEST_TTL_SECONDS);
    return { value, createdAt: Date.now() };
  }
  async getAsync(key: string): Promise<string | null> {
    return this.redis.get(`idn:saml:req:${key}`);
  }
  removeAsync(key: string | null): Promise<string | null> {
    return Promise.resolve(key);
  }

  async consume(key: string): Promise<void> {
    await this.redis.del(`idn:saml:req:${key}`);
  }
}

/**
 * SAML 2.0 service provider on @node-saml/node-saml (signature validation with XML signature
 * wrapping defences, audience, NotBefore/NotOnOrAfter, InResponseTo) plus Verbis rules:
 * signed assertions are mandatory, assertion ids are single-use, transient NameIDs are refused,
 * unsolicited (IdP-initiated) responses only where the tenant allows them, optional mandatory
 * encryption, and decryption with every non-retired-away key during rotation.
 */
@Injectable()
export class SamlService {
  readonly #cache: RedisCacheProvider;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(RedisService) redis: RedisService,
  ) {
    this.#cache = new RedisCacheProvider(redis.client);
  }

  private client(
    idp: SamlIdp,
    keys: SamlKeys,
    endpoints: SamlEndpoints,
    decryptionKey?: string,
  ): SAML {
    const config = idp.config;
    return new SAML({
      entryPoint: config.ssoUrl,
      ...(config.sloUrl === undefined ? {} : { logoutUrl: config.sloUrl }),
      issuer: endpoints.entityId,
      audience: endpoints.entityId,
      callbackUrl: endpoints.acsUrl,
      logoutCallbackUrl: endpoints.sloUrl,
      idpIssuer: config.idpEntityId,
      idpCert: [...config.idpCertificates],
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      identifierFormat: samlNameIdFormat(config),
      acceptedClockSkewMs: this.env.IDENTITY_CLOCK_SKEW_SECONDS * 1000,
      maxAssertionAgeMs: 10 * 60 * 1000,
      validateInResponseTo: config.allowIdpInitiated
        ? ValidateInResponseTo.ifPresent
        : ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: REQUEST_TTL_SECONDS * 1000,
      cacheProvider: this.#cache,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
      disableRequestedAuthnContext: config.authnContext === undefined,
      ...(config.authnContext === undefined ? {} : { authnContext: [...config.authnContext] }),
      ...(config.signRequests && keys.signingKey !== undefined
        ? { privateKey: keys.signingKey }
        : {}),
      ...(decryptionKey === undefined ? {} : { decryptionPvk: decryptionKey }),
    });
  }

  /** SP-initiated AuthnRequest (HTTP-Redirect binding); returns the URL and the request id. */
  async authnRequestUrl(
    idp: SamlIdp,
    keys: SamlKeys,
    endpoints: SamlEndpoints,
    relayState: string,
  ): Promise<{ url: string; requestId: string }> {
    const url = await this.client(idp, keys, endpoints).getAuthorizeUrlAsync(
      relayState,
      undefined,
      {},
    );
    const request = new URL(url).searchParams.get('SAMLRequest');
    const requestId = request === null ? undefined : this.requestIdOf(request);
    if (requestId === undefined) throw new SamlLoginError('authn_request_build_failed');
    return { url, requestId };
  }

  private requestIdOf(deflated: string): string | undefined {
    const xml = inflateRawSync(Buffer.from(deflated, 'base64')).toString('utf8');
    return /\sID="([^"]+)"/.exec(xml)?.[1];
  }

  /** Validates a POSTed SAMLResponse at the ACS. */
  async validateResponse(
    idp: SamlIdp,
    keys: SamlKeys,
    endpoints: SamlEndpoints,
    body: { SAMLResponse?: unknown; RelayState?: unknown },
    expectedRequestId: string | undefined,
  ): Promise<ValidatedAssertion> {
    if (typeof body.SAMLResponse !== 'string' || body.SAMLResponse.length > 1_000_000) {
      throw new SamlLoginError('response_missing');
    }
    const container = { SAMLResponse: body.SAMLResponse };
    const xml = Buffer.from(body.SAMLResponse, 'base64').toString('utf8');
    const responseInResponseTo = /<(?:\w+:)?Response\b[^>]*\sInResponseTo="([^"]+)"/.exec(xml)?.[1];
    if (responseInResponseTo === undefined && !idp.config.allowIdpInitiated)
      throw new SamlLoginError('unsolicited_response');
    if (expectedRequestId !== undefined && responseInResponseTo !== expectedRequestId)
      throw new SamlLoginError('in_response_to_mismatch');
    if (expectedRequestId === undefined && responseInResponseTo !== undefined)
      throw new SamlLoginError('transaction_missing');
    const encrypted = /<(?:\w+:)?EncryptedAssertion\b/.test(xml);
    if (idp.config.requireEncryptedAssertions && !encrypted)
      throw new SamlLoginError('assertion_not_encrypted');

    const candidates: (string | undefined)[] = encrypted ? [...keys.decryptionKeys] : [undefined];
    if (candidates.length === 0) throw new SamlLoginError('no_decryption_key');
    let profile: Profile | null = null;
    let lastError: unknown;
    for (const key of candidates) {
      try {
        const result = await this.client(idp, keys, endpoints, key).validatePostResponseAsync(
          container,
        );
        profile = result.profile;
        break;
      } catch (error) {
        lastError = error;
        // Encrypted responses are retried with the next key (rotation); validation is otherwise
        // deterministic, so a non-decryption failure fails the same way with every key.
      }
    }
    if (profile === null) {
      throw new SamlLoginError(
        lastError instanceof Error && /InResponseTo/i.test(lastError.message)
          ? 'in_response_to_invalid'
          : 'response_invalid',
      );
    }
    if (responseInResponseTo !== undefined) await this.#cache.consume(responseInResponseTo);
    return this.toAssertion(idp, profile, responseInResponseTo);
  }

  private toAssertion(
    idp: SamlIdp,
    profile: Profile,
    inResponseTo: string | undefined,
  ): ValidatedAssertion {
    if (profile.nameIDFormat === TRANSIENT) throw new SamlLoginError('transient_name_id');
    if (typeof profile.nameID !== 'string' || profile.nameID === '')
      throw new SamlLoginError('name_id_missing');
    const assertionXml = profile.getAssertionXml?.() ?? '';
    const doc = new DOMParser().parseFromString(assertionXml, 'text/xml');
    const assertion = doc.documentElement;
    const assertionId = assertion?.getAttribute('ID') ?? '';
    if (assertionId === '') throw new SamlLoginError('assertion_id_missing');
    // The signature proves which key signed; the issuer must also be this IdP (node-saml does not
    // enforce idpIssuer on assertions).
    const issuer = /<(?:\w+:)?Issuer\b[^>]*>([^<]+)<\/(?:\w+:)?Issuer>/
      .exec(assertionXml)?.[1]
      ?.trim();
    if (issuer !== idp.config.idpEntityId) throw new SamlLoginError('issuer_mismatch');
    const conditions = /<(?:\w+:)?Conditions\b[^>]*\sNotOnOrAfter="([^"]+)"/.exec(
      assertionXml,
    )?.[1];

    const attributes = (profile['attributes'] ?? {}) as Record<string, unknown>;
    const names = samlAttributeNames(idp.config);
    const first = (name: string | undefined) =>
      name === undefined ? undefined : claimStrings(attributes[name])[0];
    const emailAttr =
      first(names.email) ?? (typeof profile.email === 'string' ? profile.email : undefined);
    const email = emailAttr ?? (profile.nameIDFormat === EMAIL_FORMAT ? profile.nameID : undefined);
    const given = first(names.givenName);
    const family = first(names.familyName);
    const displayName =
      first(names.displayName) ?? ([given, family].filter(Boolean).join(' ') || undefined);
    return {
      identity: {
        subject: `${profile.nameIDFormat}|${profile.nameID}`,
        ...(email === undefined ? {} : { email }),
        // SAML has no verification flag: linking by email is a per-IdP trust decision.
        emailVerified: email !== undefined,
        ...(displayName === undefined ? {} : { displayName }),
        claims: { ...attributes, groups: attributes[names.groups] ?? [] },
      },
      nameId: profile.nameID,
      nameIdFormat: profile.nameIDFormat,
      ...(profile.sessionIndex === undefined ? {} : { sessionIndex: profile.sessionIndex }),
      ...(profile.nameQualifier === undefined ? {} : { nameQualifier: profile.nameQualifier }),
      ...(profile.spNameQualifier === undefined
        ? {}
        : { spNameQualifier: profile.spNameQualifier }),
      ...(inResponseTo === undefined ? {} : { inResponseTo }),
      assertionId,
      ...(conditions === undefined ? {} : { notOnOrAfter: new Date(conditions) }),
    };
  }

  /** SP-initiated SLO: LogoutRequest URL for a session. */
  async logoutRequestUrl(
    idp: SamlIdp,
    keys: SamlKeys,
    endpoints: SamlEndpoints,
    session: {
      nameId: string;
      nameIdFormat: string;
      sessionIndex?: string | undefined;
      nameQualifier?: string | undefined;
      spNameQualifier?: string | undefined;
    },
    relayState: string,
  ): Promise<string | undefined> {
    if (idp.config.sloUrl === undefined) return undefined;
    const profile: Profile = {
      issuer: idp.config.idpEntityId,
      nameID: session.nameId,
      nameIDFormat: session.nameIdFormat,
      ...(session.sessionIndex === undefined ? {} : { sessionIndex: session.sessionIndex }),
      ...(session.nameQualifier === undefined ? {} : { nameQualifier: session.nameQualifier }),
      ...(session.spNameQualifier === undefined
        ? {}
        : { spNameQualifier: session.spNameQualifier }),
    };
    return this.client(idp, keys, endpoints).getLogoutUrlAsync(profile, relayState, {});
  }

  /**
   * Message at the SLO endpoint: an IdP-initiated LogoutRequest (returns who to log out and the
   * LogoutResponse URL) or the LogoutResponse ending an SP-initiated logout.
   */
  async handleSloMessage(
    idp: SamlIdp,
    keys: SamlKeys,
    endpoints: SamlEndpoints,
    message:
      | { method: 'GET'; query: Record<string, string>; rawQuery: string }
      | { method: 'POST'; body: Record<string, string> },
  ): Promise<
    | { kind: 'request'; nameId: string; sessionIndexes: string[]; responseUrl: string }
    | { kind: 'response' }
  > {
    const saml = this.client(idp, keys, endpoints, keys.decryptionKeys[0]);
    const isRequest =
      message.method === 'GET'
        ? message.query['SAMLRequest'] !== undefined
        : message.body['SAMLRequest'] !== undefined;
    try {
      const result =
        message.method === 'GET'
          ? await saml.validateRedirectAsync(message.query, message.rawQuery)
          : isRequest
            ? await saml.validatePostRequestAsync(message.body)
            : await saml.validatePostResponseAsync(message.body);
      if (!isRequest) return { kind: 'response' };
      const profile = result.profile;
      if (profile === null) throw new SamlLoginError('logout_request_invalid');
      const relay =
        message.method === 'GET'
          ? (message.query['RelayState'] ?? '')
          : (message.body['RelayState'] ?? '');
      const responseUrl = await saml.getLogoutResponseUrlAsync(profile, relay, {}, true);
      const indexes = claimStrings(profile.sessionIndex);
      return { kind: 'request', nameId: profile.nameID, sessionIndexes: indexes, responseUrl };
    } catch (error) {
      if (error instanceof SamlLoginError) throw error;
      throw new SamlLoginError('slo_message_invalid');
    }
  }
}

/** Credentials usable now: signing = active; decryption = active, then next and retired ones. */
export function usableCredentials(credentials: readonly SpCredential[]): {
  signing?: SpCredential;
  encryption: SpCredential[];
} {
  const signing = credentials.find((c) => c.use === 'signing' && c.state === 'active');
  const order = { active: 0, next: 1, retired: 2 } as const;
  const encryption = credentials
    .filter((c) => c.use === 'encryption')
    .sort((a, b) => order[a.state] - order[b.state]);
  return { ...(signing === undefined ? {} : { signing }), encryption };
}
