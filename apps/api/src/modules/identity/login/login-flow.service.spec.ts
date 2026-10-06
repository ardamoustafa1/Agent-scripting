import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { DomainError } from '../../../common/errors/domain-errors.js';
import { AppOrigins } from '../core/app-origins.js';
import { sha256Hex } from '../crypto/random.js';
import { OidcConfigSchema, SamlConfigSchema } from '../idp/idp-config.js';
import { OidcLoginError } from '../oidc/oidc.service.js';
import { SamlLoginError } from '../saml/saml.service.js';
import { generateSpCredential } from '../saml/sp-credentials.js';

import { LoginFlowService } from './login-flow.service.js';
import { LoginFailedError, LoginRejectedError } from './login.service.js';

import type { LoginTransactions, LoginTransaction } from './login-transaction.js';
import type { LoginService } from './login.service.js';
import type { ApiEnv } from '../../../env.js';
import type { TransactionClient } from '../../../infra/database/prisma.service.js';
import type { IdentitySecrets } from '../core/identity-secrets.js';
import type { IdentityTx } from '../core/identity-tx.js';
import type { TenantResolver } from '../core/tenant-resolver.js';
import type { LoadedIdp } from '../idp/idp.repository.js';
import type { OidcService } from '../oidc/oidc.service.js';
import type { SamlService } from '../saml/saml.service.js';
import type { SessionStore } from '../session/session-store.js';
import type { SessionService } from '../session/session.service.js';
import type { SessionRecord } from '../session/session.types.js';

const tenantId = '01990000-0000-7000-8000-000000000001',
  id = '01990000-0000-7000-8000-000000000002',
  secretId = '01990000-0000-7000-8000-000000000003';
let certificate: string;
beforeAll(async () => {
  certificate = (await generateSpCredential('Synthetic flow fixture', new Date())).certificate;
});
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const tenant = { id: tenantId, slug: 'synthetic', status: 'active' };
  const idp: LoadedIdp = {
    id,
    tenantId,
    version: 1,
    protocol: 'oidc',
    displayName: 'Synthetic',
    status: 'active',
    domainHints: [],
    jitProvisioning: false,
    scimEnabled: false,
    config: OidcConfigSchema.parse({
      vendor: 'generic',
      issuer: 'https://synthetic-idp.example.invalid',
      clientId: 'synthetic',
      clientSecretRef: secretId,
    }),
  };
  const transaction: LoginTransaction = {
    tenantId,
    tenantSlug: tenant.slug,
    idpId: id,
    protocol: 'oidc',
    app: 'agent',
    returnTo: '/sessions',
    callbackUrl: 'https://synthetic.example.invalid/api/auth/oidc/callback',
    browserBinding: sha256Hex('synthetic-browser-cookie'),
    createdAt: Date.now(),
    oidc: {
      state: 'synthetic-state',
      nonce: 'synthetic-nonce',
      codeVerifier: 'synthetic-verifier',
    },
  };
  const tx = { tenant: { findFirst: vi.fn().mockResolvedValue({ slug: tenant.slug }) } };
  const tenants = {
    bySlug: vi.fn().mockResolvedValue(tenant),
    byEmailDomain: vi.fn().mockResolvedValue([{ tenantId, tenantSlug: tenant.slug, idpId: id }]),
  };
  const idps = {
    findActive: vi.fn().mockResolvedValue(idp),
    find: vi.fn().mockResolvedValue(idp),
    listActive: vi.fn().mockResolvedValue([idp]),
  };
  const secrets = { reveal: vi.fn().mockResolvedValue('synthetic-client-secret') };
  const tokens: { subject: string; claims: Record<string, unknown> } = {
    subject: 'synthetic-subject',
    claims: {
      email: 'synthetic@example.invalid',
      email_verified: true,
      name: 'Synthetic',
      locale: 'en',
    },
  };
  const oidc = {
    configuration: vi.fn().mockResolvedValue({}),
    authorizationRequest: vi.fn().mockResolvedValue({
      nonce: 'synthetic-nonce',
      codeVerifier: 'synthetic-verifier',
      url: 'https://synthetic-idp.example.invalid/authorize',
    }),
    redeem: vi.fn().mockResolvedValue(tokens),
    endSessionUrl: vi.fn().mockReturnValue('https://synthetic-idp.example.invalid/logout'),
    verifyLogoutToken: vi.fn().mockResolvedValue({
      sid: 'synthetic-sid',
      jti: 'synthetic-jti',
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
    issuer: () => 'https://synthetic-idp.example.invalid',
  };
  const login = {
    completeSsoLogin: vi.fn().mockResolvedValue({
      token: 'synthetic-session-token',
      record: { createdAt: 1000, absoluteExpiresAt: 61000 },
    }),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const saml = {
    authnRequestUrl: vi.fn().mockResolvedValue({
      requestId: 'synthetic-request',
      url: 'https://synthetic-idp.example.invalid/sso',
    }),
    validateResponse: vi.fn().mockResolvedValue({
      nameId: 'synthetic-name-id',
      nameIdFormat: 'synthetic-format',
      identity: { subject: 'synthetic-name-id', emailVerified: false, claims: {} },
    }),
    logoutRequestUrl: vi.fn().mockResolvedValue('https://synthetic-idp.example.invalid/slo'),
    handleSloMessage: vi.fn().mockResolvedValue({
      kind: 'request',
      nameId: 'synthetic-name-id',
      sessionIndexes: ['synthetic-index'],
      responseUrl: 'https://synthetic-idp.example.invalid/slo-response',
    }),
  };
  const sessions = {
    recordEnded: vi.fn().mockResolvedValue(undefined),
    recordEndedInRequest: vi.fn().mockResolvedValue(undefined),
  };
  const store = {
    revokeHash: vi.fn().mockResolvedValue(undefined),
    revokeByOidcSid: vi.fn().mockResolvedValue([]),
    revokeByOidcSubject: vi.fn().mockResolvedValue([]),
  };
  const transactions = {
    put: vi.fn().mockResolvedValue('synthetic-state'),
    take: vi.fn().mockResolvedValue(transaction),
    markOnce: vi.fn().mockResolvedValue(true),
  };
  const origins = new AppOrigins({ agent: 'https://{tenant}.example.invalid' }, '/api');
  const service = new LoginFlowService(
    { PUBLIC_API_URL: 'https://synthetic-api.example.invalid' } as ApiEnv,
    origins,
    tenants as unknown as TenantResolver,
    {
      run: (_tenant: string, _actor: unknown, fn: (tx: TransactionClient) => Promise<unknown>) =>
        fn(tx as unknown as TransactionClient),
    } as unknown as IdentityTx,
    idps,
    secrets as unknown as IdentitySecrets,
    oidc as unknown as OidcService,
    saml as unknown as SamlService,
    login as unknown as LoginService,
    sessions as unknown as SessionService,
    store as unknown as SessionStore,
    transactions as unknown as LoginTransactions,
  );
  const browser = { ip: '', userAgent: 'Synthetic', transactionCookie: 'synthetic-browser-cookie' };
  const callback = () =>
    service.oidcCallback(
      { state: 'synthetic-state' },
      'state=synthetic-state&code=synthetic-code',
      browser,
    );
  return {
    service,
    tenant,
    tx,
    idp,
    tenants,
    idps,
    secrets,
    oidc,
    saml,
    login,
    sessions,
    store,
    transactions,
    transaction,
    browser,
    tokens,
    callback,
  };
}

it('discovers only providers claimed by an email realm and returns no internals', async () => {
  const f = fixture();
  f.idps.listActive.mockResolvedValue([f.idp, { ...f.idp, id: secretId }]);
  expect(await f.service.discover({ email: 'SYNTHETIC@EXAMPLE.INVALID' })).toEqual({
    tenant: 'synthetic',
    providers: [{ id, displayName: 'Synthetic', protocol: 'oidc' }],
  });
  expect(f.tenants.byEmailDomain).toHaveBeenCalledWith('example.invalid');
  expect(await f.service.discover({ tenant: 'synthetic' })).toMatchObject({ tenant: 'synthetic' });
});

it.each([
  'invalidDomain',
  'missingRealm',
  'missingInput',
  'missingTenant',
  'inactiveTenant',
] as const)('does not disclose providers for %s', async (reason) => {
  const f = fixture();
  if (reason === 'missingRealm') f.tenants.byEmailDomain.mockResolvedValue([]);
  if (reason === 'missingTenant') f.tenants.bySlug.mockResolvedValue(undefined);
  if (reason === 'inactiveTenant') f.tenant.status = 'disabled';
  expect(
    await f.service.discover(
      reason === 'missingInput'
        ? {}
        : reason === 'invalidDomain'
          ? { email: 'malformed' }
          : reason === 'missingRealm'
            ? { email: 'synthetic@example.invalid' }
            : { tenant: 'synthetic' },
    ),
  ).toBeUndefined();
  expect(f.idps.listActive).not.toHaveBeenCalled();
});

it.each([true, false])(
  'starts a browser-bound OIDC transaction with explicit provider %s',
  async (explicit) => {
    const f = fixture();
    expect(
      await f.service.start({
        tenant: 'synthetic',
        app: 'agent',
        transactionCookie: 'synthetic-browser-cookie',
        returnTo: '//rogue.example.invalid',
        ...(explicit ? { idpId: id } : {}),
      }),
    ).toBe('https://synthetic-idp.example.invalid/authorize');
    const saved = f.transactions.put.mock.calls[0]![0] as LoginTransaction;
    expect(saved).toMatchObject({
      tenantId,
      idpId: id,
      app: 'agent',
      returnTo: '/',
      browserBinding: sha256Hex('synthetic-browser-cookie'),
    });
    expect(saved.oidc?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(saved)).not.toContain('synthetic-client-secret');
  },
);

it.each(['tenant', 'app', 'ambiguous', 'idp', 'secret'] as const)(
  'rejects unsafe login start: %s',
  async (reason) => {
    const f = fixture();
    if (reason === 'tenant') f.tenant.status = 'disabled';
    if (reason === 'ambiguous')
      f.idps.listActive.mockResolvedValue([f.idp, { ...f.idp, id: secretId }]);
    if (reason === 'idp') f.idps.listActive.mockResolvedValue([]);
    if (reason === 'secret') f.secrets.reveal.mockResolvedValue(undefined);
    await expect(
      f.service.start({
        tenant: 'synthetic',
        app: reason === 'app' ? 'rogue' : 'agent',
        transactionCookie: 'synthetic-browser-cookie',
      }),
    ).rejects.toThrow();
    expect(f.transactions.put).not.toHaveBeenCalled();
  },
);

it('completes a valid OIDC callback and applies the persisted safe destination/session lifetime', async () => {
  const f = fixture();
  expect(await f.callback()).toEqual({
    redirectUrl: 'https://synthetic.example.invalid/sessions',
    session: { token: 'synthetic-session-token', maxAgeSeconds: 60 },
  });
  expect(f.login.completeSsoLogin.mock.calls[0]![1]).toMatchObject({
    subject: 'synthetic-subject',
    email: 'synthetic@example.invalid',
    emailVerified: true,
    displayName: 'Synthetic',
    locale: 'en',
  });
});

// M-Z6: without a `name` claim JIT stored the e-mail as the greeting name; use the standard
// given/family name, then preferred_username, before giving up.
it.each([
  [{ given_name: 'Ayşe', family_name: 'Yılmaz' }, 'Ayşe Yılmaz'],
  [{ given_name: 'Ayşe' }, 'Ayşe'],
  [{ preferred_username: 'ayse.yilmaz' }, 'ayse.yilmaz'],
  [{ name: '  ', given_name: 'Ayşe' }, 'Ayşe'],
])('derives an OIDC display name from standard claims %j', async (claims, expected) => {
  const f = fixture();
  f.tokens.claims = { email: 'synthetic@example.invalid', email_verified: true, ...claims };
  await f.callback();
  expect(f.login.completeSsoLogin.mock.calls[0]![1]).toMatchObject({ displayName: expected });
});
it('omits the display name when no name claim exists so JIT keeps its own fallback', async () => {
  const f = fixture();
  f.tokens.claims = { email: 'synthetic@example.invalid', email_verified: true };
  await f.callback();
  expect(f.login.completeSsoLogin.mock.calls[0]![1]).not.toHaveProperty('displayName');
});

it.each(['cookie', 'binding', 'age', 'idp'] as const)(
  'rejects a callback with invalid %s before redeeming its code',
  async (reason) => {
    const f = fixture();
    if (reason === 'cookie') f.browser.transactionCookie = 'another-browser';
    if (reason === 'binding') f.transaction.browserBinding = '';
    if (reason === 'age') f.transaction.createdAt = Date.now() - 600_000;
    if (reason === 'idp') f.idps.findActive.mockResolvedValue(undefined);
    expect(await f.callback()).toEqual({
      redirectUrl: 'https://synthetic.example.invalid/?authError=login_failed',
    });
    expect(f.oidc.redeem).not.toHaveBeenCalled();
    expect(f.login.recordFailure).toHaveBeenCalledTimes(1);
  },
);

it.each(['missing', 'protocol', 'data'] as const)(
  'rejects absent or consumed OIDC transaction %s',
  async (reason) => {
    const f = fixture();
    if (reason === 'missing') f.transactions.take.mockResolvedValue(undefined);
    if (reason === 'protocol') f.transaction.protocol = 'saml';
    if (reason === 'data') delete f.transaction.oidc;
    await expect(f.callback()).rejects.toMatchObject({ code: 'VERBIS_AUTH_LOGIN_FAILED' });
    expect(f.login.completeSsoLogin).not.toHaveBeenCalled();
  },
);

it.each([new OidcLoginError('synthetic'), new DomainError('VERBIS_IDENTITY_IDP_CONFIG_INVALID')])(
  'audits protocol failure and returns a safe redirect',
  async (error) => {
    const f = fixture();
    f.oidc.redeem.mockRejectedValue(error);
    expect(await f.callback()).toEqual({
      redirectUrl: 'https://synthetic.example.invalid/?authError=login_failed',
    });
    expect(f.login.recordFailure.mock.calls[0]?.[1]).toBe('protocol_error');
  },
);

it.each(['user_not_provisioned', 'user_inactive', 'session_limit'] as const)(
  'maps completed login refusal %s to a browser-safe code',
  async (reason) => {
    const f = fixture();
    f.login.completeSsoLogin.mockRejectedValue(new LoginFailedError(reason));
    expect((await f.callback()).redirectUrl).toContain(
      `authError=${reason === 'user_not_provisioned' ? 'not_provisioned' : reason === 'user_inactive' ? 'inactive' : 'session_limit'}`,
    );
  },
);

it('records rejected identity policy and propagates unexpected failures', async () => {
  const f = fixture();
  f.login.completeSsoLogin.mockRejectedValue(new LoginRejectedError('transaction_invalid'));
  expect((await f.callback()).redirectUrl).toContain('authError=login_failed');
  expect(f.login.recordFailure).toHaveBeenCalledTimes(1);
  f.oidc.redeem.mockRejectedValue(new Error('Synthetic storage outage'));
  await expect(f.callback()).rejects.toThrow('Synthetic storage outage');
});

it.each([true, false])(
  'revokes the local session before best-effort remote logout %s',
  async (remote) => {
    const f = fixture();
    const record = {
      tenantId,
      app: 'agent',
      ...(remote
        ? { idpId: id, oidc: { sub: 'synthetic-subject', idToken: 'synthetic-id-token' } }
        : {}),
    } as SessionRecord;
    expect(await f.service.logout('synthetic-hash', record)).toEqual({
      redirectUrl: remote
        ? 'https://synthetic-idp.example.invalid/logout'
        : 'https://synthetic.example.invalid/',
    });
    expect(f.store.revokeHash).toHaveBeenCalledWith('synthetic-hash');
    expect(f.sessions.recordEndedInRequest).toHaveBeenCalledWith([record], 'logout');
    if (remote) {
      f.oidc.configuration.mockRejectedValue(new Error('Synthetic IdP unavailable'));
      expect(await f.service.logout('synthetic-hash', record)).toEqual({
        redirectUrl: 'https://synthetic.example.invalid/',
      });
    }
  },
);

it.each([true, false])('revokes backchannel sessions by sid when present: %s', async (sid) => {
  const f = fixture();
  if (!sid)
    f.oidc.verifyLogoutToken.mockResolvedValue({
      sub: 'synthetic-subject',
      jti: 'synthetic-jti',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
  await f.service.backchannelLogout('synthetic', id, 'synthetic-logout-token');
  expect(f.store.revokeByOidcSid).toHaveBeenCalledTimes(sid ? 1 : 0);
  expect(f.store.revokeByOidcSubject).toHaveBeenCalledTimes(sid ? 0 : 1);
  expect(f.transactions.markOnce.mock.calls[0]?.[0]).toBe('logout-jti');
  f.transactions.markOnce.mockResolvedValue(false);
  await expect(
    f.service.backchannelLogout('synthetic', id, 'synthetic-logout-token'),
  ).rejects.toThrow('logout_token_replayed');
});

it.each([undefined, 'x'.repeat(16385)])(
  'rejects invalid backchannel logout token length before verification',
  async (token) => {
    const f = fixture();
    await expect(f.service.backchannelLogout('synthetic', id, token)).rejects.toThrow(
      'logout_token_missing',
    );
    expect(f.oidc.verifyLogoutToken).not.toHaveBeenCalled();
  },
);

it.each(['sid', 'longSid', 'issuer', 'idp', 'valid'] as const)(
  'requires trusted frontchannel issuer and session id: %s',
  async (reason) => {
    const f = fixture();
    if (reason === 'idp') f.idps.findActive.mockResolvedValue(undefined);
    const result = await f.service.frontchannelLogout(
      'synthetic',
      id,
      reason === 'issuer'
        ? 'https://rogue.example.invalid'
        : 'https://synthetic-idp.example.invalid',
      reason === 'sid' ? undefined : reason === 'longSid' ? 'x'.repeat(513) : 'synthetic-sid',
    );
    expect(result).toBe(reason === 'valid' ? 'https://synthetic-idp.example.invalid' : undefined);
    expect(f.store.revokeByOidcSid).toHaveBeenCalledTimes(reason === 'valid' ? 1 : 0);
  },
);

function samlFixture() {
  const f = fixture();
  const config = SamlConfigSchema.parse({
    vendor: 'generic',
    idpEntityId: 'synthetic',
    ssoUrl: 'https://synthetic-idp.example.invalid/sso',
    idpCertificates: [certificate],
    spCredentials: [
      {
        id,
        use: 'signing',
        state: 'active',
        certificate,
        privateKeyRef: secretId,
        notAfter: '2027-10-04T00:00:00Z',
      },
      {
        id: secretId,
        use: 'encryption',
        state: 'active',
        certificate,
        privateKeyRef: secretId,
        notAfter: '2027-10-04T00:00:00Z',
      },
    ],
  });
  const idp: LoadedIdp = { ...f.idp, protocol: 'saml', config };
  f.idps.findActive.mockResolvedValue(idp);
  f.idps.find.mockResolvedValue(idp);
  f.idps.listActive.mockResolvedValue([idp]);
  f.transaction.protocol = 'saml';
  f.transaction.saml = { requestId: 'synthetic-request' };
  delete f.transaction.oidc;
  const acs = () =>
    f.service.samlAcs(
      'synthetic',
      id,
      { RelayState: 'synthetic-relay', SAMLResponse: 'synthetic-assertion' },
      f.browser,
    );
  return { ...f, config, samlIdp: idp, acs };
}

it('starts SAML with a browser-bound relay and publishes public SP certificates only', async () => {
  const f = samlFixture();
  expect(
    await f.service.start({
      tenant: 'synthetic',
      app: 'agent',
      transactionCookie: 'synthetic-browser-cookie',
    }),
  ).toBe('https://synthetic-idp.example.invalid/sso');
  expect(f.transactions.put.mock.calls[0]![0]).toMatchObject({
    protocol: 'saml',
    saml: { requestId: 'synthetic-request' },
    browserBinding: sha256Hex('synthetic-browser-cookie'),
  });
  const metadata = await f.service.spMetadata('synthetic', id);
  expect(metadata).toContain('X509Certificate');
  expect(metadata).toContain('/auth/saml/synthetic/');
  expect(metadata).not.toContain('synthetic-client-secret');
});

it.each([
  'valid',
  'browser',
  'unsolicited',
  'allowedUnsolicited',
  'protocol',
  'unexpected',
] as const)('handles SAML callback %s without weakening browser binding', async (reason) => {
  const f = samlFixture();
  if (reason === 'browser') f.browser.transactionCookie = 'other-browser';
  if (reason === 'unsolicited' || reason === 'allowedUnsolicited')
    f.transactions.take.mockResolvedValue(undefined);
  if (reason === 'allowedUnsolicited') f.config.allowIdpInitiated = true;
  if (reason === 'protocol')
    f.saml.validateResponse.mockRejectedValue(new SamlLoginError('synthetic-rejected'));
  if (reason === 'unexpected') {
    f.saml.validateResponse.mockRejectedValue(new Error('Synthetic storage failure'));
    await expect(f.acs()).rejects.toThrow('Synthetic storage failure');
    return;
  }
  const result = await f.acs();
  expect(result.redirectUrl).toContain(
    reason === 'valid'
      ? '/sessions'
      : reason === 'allowedUnsolicited'
        ? 'https://synthetic.example.invalid/'
        : 'authError=login_failed',
  );
  expect(f.login.completeSsoLogin).toHaveBeenCalledTimes(
    reason === 'valid' || reason === 'allowedUnsolicited' ? 1 : 0,
  );
});

it('handles missing SP secrets without leaking configuration and requires the SAML protocol', async () => {
  const f = samlFixture();
  f.secrets.reveal.mockResolvedValue(undefined);
  await f.acs();
  expect(f.saml.validateResponse.mock.calls[0]![1]).toEqual({ decryptionKeys: [] });
  f.config.spCredentials = [];
  await f.acs();
  expect(f.saml.validateResponse.mock.calls[1]![1]).toEqual({ decryptionKeys: [] });
  f.idps.findActive.mockResolvedValue(undefined);
  f.idps.find.mockResolvedValue(undefined);
  await expect(f.acs()).rejects.toMatchObject({ code: 'VERBIS_AUTH_LOGIN_FAILED' });
  await expect(f.service.spMetadata('synthetic', id)).rejects.toMatchObject({
    code: 'VERBIS_RESOURCE_NOT_FOUND',
  });
});

it.each(['request', 'response', 'invalid', 'unexpected'] as const)(
  'validates SAML logout %s before revoking matched sessions',
  async (kind) => {
    const f = samlFixture();
    if (kind === 'response') f.saml.handleSloMessage.mockResolvedValue({ kind: 'response' });
    if (kind === 'invalid')
      f.saml.handleSloMessage.mockRejectedValue(new SamlLoginError('synthetic-rejected'));
    if (kind === 'unexpected')
      f.saml.handleSloMessage.mockRejectedValue(new Error('Synthetic storage failure'));
    const revokeBySaml = vi.fn().mockResolvedValue([]);
    Object.assign(f.store, { revokeBySaml });
    const pending = f.service.samlSlo('synthetic', id, {
      method: 'GET',
      query: { RelayState: 'agent' },
      rawQuery: 'RelayState=agent',
    });
    if (kind === 'invalid' || kind === 'unexpected') {
      await expect(pending).rejects.toThrow(
        kind === 'invalid' ? 'Invalid SAML logout message' : 'Synthetic storage failure',
      );
      expect(revokeBySaml).not.toHaveBeenCalled();
    } else {
      expect(await pending).toBe(
        kind === 'request'
          ? 'https://synthetic-idp.example.invalid/slo-response'
          : 'https://synthetic.example.invalid/',
      );
      expect(revokeBySaml).toHaveBeenCalledTimes(kind === 'request' ? 1 : 0);
    }
  },
);

it('ends a SAML browser session before redirecting to the IdP logout endpoint', async () => {
  const f = samlFixture();
  const record = {
    tenantId,
    app: 'agent',
    idpId: id,
    saml: { nameId: 'synthetic-name-id', nameIdFormat: 'synthetic-format' },
  } as SessionRecord;
  expect(await f.service.logout('synthetic-hash', record)).toEqual({
    redirectUrl: 'https://synthetic-idp.example.invalid/slo',
  });
  expect(f.store.revokeHash).toHaveBeenCalledTimes(1);
  expect(f.sessions.recordEndedInRequest).toHaveBeenCalledWith([record], 'logout');
  expect(f.service.tenantFromHost('synthetic.example.invalid', 'https')).toBe('synthetic');
});
