import { beforeAll, describe, expect, it } from 'vitest';

import { MockSamlIdp } from '../../../../test/support/mock-saml-idp.js';
import { SamlConfigSchema } from '../idp/idp-config.js';

import { SamlService } from './saml.service.js';
import { generateSpCredential } from './sp-credentials.js';

import type { GeneratedCredential } from './sp-credentials.js';
import type { ApiEnv } from '../../../env.js';
import type { RedisService } from '../../../infra/redis/redis.service.js';
import type { SamlIdp } from '../idp/idp.repository.js';

let provider: MockSamlIdp, credential: GeneratedCredential;
beforeAll(async () => {
  provider = new MockSamlIdp();
  await provider.init();
  credential = await generateSpCredential('Synthetic SP');
});
const endpoints = {
  entityId: 'https://synthetic-sp.test/saml',
  acsUrl: 'https://synthetic-sp.test/acs',
  sloUrl: 'https://synthetic-sp.test/slo',
};
function fixture() {
  const requests = new Map<string, string>();
  const redis = {
    set: (key: string, value: string) => Promise.resolve(requests.set(key, value)),
    get: (key: string) => Promise.resolve(requests.get(key) ?? null),
    del: (key: string) => Promise.resolve(requests.delete(key)),
  };
  const service = new SamlService(
    { IDENTITY_CLOCK_SKEW_SECONDS: 0 } as ApiEnv,
    { client: redis } as unknown as RedisService,
  );
  const idp = {
    id: 'synthetic',
    config: SamlConfigSchema.parse({
      vendor: 'generic',
      idpEntityId: provider.entityId,
      ssoUrl: provider.ssoUrl,
      idpCertificates: [provider.credential.certificate],
      allowIdpInitiated: true,
      attributes: {
        email: 'mail',
        givenName: 'first',
        familyName: 'last',
        displayName: 'display',
        groups: 'groups',
      },
    }),
  } as SamlIdp;
  const keys = { signingKey: credential.privateKey, decryptionKeys: [] as string[] };
  const response = (
    options: Parameters<MockSamlIdp['response']>[0] = {
      acsUrl: endpoints.acsUrl,
      audience: endpoints.entityId,
    },
  ) => provider.response(options);
  return { service, idp, keys, requests, response };
}
describe('SAML real signed assertion boundaries', () => {
  it.each([
    {
      attributes: {
        mail: ['synthetic@example.invalid'],
        display: ['Synthetic display'],
        groups: ['agent'],
      },
      nameId: 'persistent-user',
      format: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      email: 'synthetic@example.invalid',
      displayName: 'Synthetic display',
    },
    {
      attributes: { first: ['Synthetic'], last: ['Author'] },
      nameId: 'synthetic-name@example.invalid',
      format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      email: 'synthetic-name@example.invalid',
      displayName: 'Synthetic Author',
    },
    {
      attributes: {},
      nameId: 'persistent-user',
      format: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      email: undefined,
      displayName: undefined,
    },
  ])(
    'maps trusted signed claims with optional attributes (%j)',
    async ({ attributes, nameId, format, email, displayName }) => {
      const f = fixture();
      const encoded = await f.response({
        acsUrl: endpoints.acsUrl,
        audience: endpoints.entityId,
        attributes,
        nameId,
        nameIdFormat: format,
      });
      const result = await f.service.validateResponse(
        f.idp,
        f.keys,
        endpoints,
        { SAMLResponse: encoded },
        undefined,
      );
      expect(result.identity.subject).toBe(`${format}|${nameId}`);
      expect(result.identity.email).toBe(email);
      expect(result.identity.displayName).toBe(displayName);
      expect(result.identity.emailVerified).toBe(email !== undefined);
      expect(result.assertionId).toMatch(/^_a/);
      expect(result.notOnOrAfter).toBeInstanceOf(Date);
    },
  );
  it.each([
    'transient',
    'missing NameID',
    'wrong issuer',
    'wrong audience',
    'expired',
    'unsigned',
  ] as const)('rejects %s assertions using actual XML signature verification', async (reason) => {
    const f = fixture();
    const encoded = await f.response({
      acsUrl: endpoints.acsUrl,
      audience: reason === 'wrong audience' ? 'https://foreign-sp.test' : endpoints.entityId,
      ...(reason === 'transient'
        ? { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' }
        : {}),
      ...(reason === 'missing NameID' ? { nameId: '' } : {}),
      ...(reason === 'wrong issuer' ? { issuer: 'https://foreign-idp.test' } : {}),
      ...(reason === 'expired' ? { notOnOrAfter: new Date(Date.now() - 60000) } : {}),
      ...(reason === 'unsigned' ? { sign: 'none' as const } : {}),
    });
    await expect(
      f.service.validateResponse(f.idp, f.keys, endpoints, { SAMLResponse: encoded }, undefined),
    ).rejects.toThrow();
  });
  it.each([
    'missing',
    'wrong type',
    'oversized',
    'unsolicited',
    'wrong request',
    'missing transaction',
    'encryption required',
    'no decryption key',
  ] as const)('fails closed before consuming unbound responses: %s', async (reason) => {
    const f = fixture();
    let response: unknown = await f.response();
    let expected: string | undefined;
    if (reason === 'missing') response = undefined;
    if (reason === 'wrong type') response = 123;
    if (reason === 'oversized') response = 'A'.repeat(1000001);
    if (reason === 'unsolicited') f.idp.config.allowIdpInitiated = false;
    if (reason === 'wrong request' || reason === 'missing transaction') {
      response = await f.response({
        acsUrl: endpoints.acsUrl,
        audience: endpoints.entityId,
        inResponseTo: '_actual',
      });
      if (reason === 'wrong request') expected = '_different';
    }
    if (reason === 'encryption required') f.idp.config.requireEncryptedAssertions = true;
    if (reason === 'no decryption key')
      response = Buffer.from('<Response><EncryptedAssertion/></Response>').toString('base64');
    await expect(
      f.service.validateResponse(f.idp, f.keys, endpoints, { SAMLResponse: response }, expected),
    ).rejects.toThrow();
  });
  it('issues a signed AuthnRequest and consumes its matching response id once validation succeeds', async () => {
    const f = fixture();
    f.idp.config.allowIdpInitiated = false;
    f.idp.config.authnContext = [
      'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
    ];
    const request = await f.service.authnRequestUrl(f.idp, f.keys, endpoints, 'synthetic-relay');
    expect(new URL(request.url).searchParams.has('Signature')).toBe(true);
    expect(new URL(request.url).searchParams.get('RelayState')).toBe('synthetic-relay');
    expect(f.requests.has(`idn:saml:req:${request.requestId}`)).toBe(true);
    const encoded = await f.response({
      acsUrl: endpoints.acsUrl,
      audience: endpoints.entityId,
      inResponseTo: request.requestId,
    });
    expect(
      (
        await f.service.validateResponse(
          f.idp,
          f.keys,
          endpoints,
          { SAMLResponse: encoded },
          request.requestId,
        )
      ).inResponseTo,
    ).toBe(request.requestId);
    expect(f.requests.has(`idn:saml:req:${request.requestId}`)).toBe(false);
    await expect(
      f.service.validateResponse(
        f.idp,
        f.keys,
        endpoints,
        { SAMLResponse: encoded },
        request.requestId,
      ),
    ).rejects.toMatchObject({ reason: 'in_response_to_invalid' });
  });
  it('supports unsigned requests when configured and returns no logout URL without SLO', async () => {
    const f = fixture();
    f.idp.config.signRequests = false;
    const request = await f.service.authnRequestUrl(
      f.idp,
      { decryptionKeys: [] },
      endpoints,
      'synthetic',
    );
    expect(new URL(request.url).searchParams.has('Signature')).toBe(false);
    const session = {
      nameId: 'synthetic',
      nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    };
    expect(
      await f.service.logoutRequestUrl(f.idp, f.keys, endpoints, session, 'synthetic'),
    ).toBeUndefined();
    f.idp.config.sloUrl = provider.sloUrl;
    expect(
      new URL(
        (await f.service.logoutRequestUrl(f.idp, f.keys, endpoints, session, 'synthetic')) ?? '',
      ).searchParams.has('SAMLRequest'),
    ).toBe(true);
  });
  it.each(['GET', 'POST'] as const)('rejects malformed %s SLO messages safely', async (method) => {
    const f = fixture();
    const message =
      method === 'GET'
        ? { method, query: { SAMLRequest: 'invalid' }, rawQuery: 'SAMLRequest=invalid' }
        : { method, body: { SAMLResponse: 'invalid' } };
    await expect(
      f.service.handleSloMessage(f.idp, f.keys, endpoints, message),
    ).rejects.toMatchObject({ reason: 'slo_message_invalid' });
  });
});
