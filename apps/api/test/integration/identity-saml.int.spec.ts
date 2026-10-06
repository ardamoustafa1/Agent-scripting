import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateSpCredential } from '../../src/modules/identity/saml/sp-credentials.js';
import { cookieHeader, setCookies } from '../support/http.js';
import { MockSamlIdp } from '../support/mock-saml-idp.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
  type TenantFixture,
} from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const ADMIN_ORIGIN = 'http://localhost:5175';
const SESSION = '__Host-verbis_session';
const TX = '__Host-verbis_session_tx';

let app: NestFastifyApplication;
let owner: PrismaClient;
let kit: TokenKit;
let idp: MockSamlIdp;
let tenant: TenantFixture;
let slug: string;

interface IdpDetail {
  id: string;
  version: number;
  config: { spCredentials: { id: string; use: string; state: string; certificate: string }[] };
  endpoints: { entityId: string; acsUrls: string[] };
}

async function createIdp(config: Record<string, unknown> = {}): Promise<IdpDetail> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/identity-providers',
    headers: await tenant.auth(),
    payload: {
      protocol: 'saml',
      displayName: 'Mock SAML',
      status: 'active',
      jitProvisioning: true,
      config: {
        vendor: 'generic',
        idpEntityId: idp.entityId,
        ssoUrl: idp.ssoUrl,
        sloUrl: idp.sloUrl,
        idpCertificates: [idp.credential.certificate],
        roleMapping: {
          defaultRoles: [],
          rules: [{ claim: 'groups', equals: 'designers', roles: ['designer'] }],
        },
        ...config,
      },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<IdpDetail>();
}

async function start(idpId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/auth/login?tenant=${slug}&app=admin&idp=${idpId}&returnTo=/scripts`,
  });
  expect(res.statusCode, res.body).toBe(302);
  const location = String(res.headers.location);
  return {
    location,
    requestId: MockSamlIdp.requestId(location),
    relayState: new URL(location).searchParams.get('RelayState') ?? '',
    tx: setCookies(res.headers)[TX] ?? '',
  };
}

async function acs(idpId: string, samlResponse: string, relayState?: string, tx?: string) {
  const body = new URLSearchParams({
    SAMLResponse: samlResponse,
    ...(relayState === undefined ? {} : { RelayState: relayState }),
  });
  return app.inject({
    method: 'POST',
    url: `/auth/saml/${slug}/${idpId}/acs`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(tx === undefined ? {} : { cookie: cookieHeader({ [TX]: tx }) }),
    },
    payload: body.toString(),
  });
}

const sessionOf = (res: { headers: Record<string, unknown> }) => setCookies(res.headers)[SESSION];

beforeAll(async () => {
  owner = ownerPrisma();
  kit = await createTokenKit();
  idp = new MockSamlIdp();
  await idp.init();
  app = await startApp(integrationEnv(kit.jwks));
  slug = uniqueSlug('saml');
  tenant = await createTenant(owner, kit, slug);
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

describe('SAML 2.0 SP-initiated login', () => {
  let detail: IdpDetail;
  beforeAll(async () => {
    detail = await createIdp();
  });

  it('publishes SP metadata with signing + encryption certificates and an ACS per app', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/auth/saml/${slug}/${detail.id}/metadata`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/samlmetadata+xml');
    expect(res.body).toContain(`entityID="${detail.endpoints.entityId}"`);
    expect(res.body).toContain('WantAssertionsSigned="true"');
    expect(res.body.match(/<md:KeyDescriptor use="signing">/g)).toHaveLength(1);
    expect(res.body.match(/<md:KeyDescriptor use="encryption">/g)).toHaveLength(1);
    expect(res.body).toContain(`Location="${ADMIN_ORIGIN}/api/auth/saml/${slug}/${detail.id}/acs"`);
    expect(res.body).not.toContain('PRIVATE KEY');
  });

  it('signs the AuthnRequest and accepts a signed assertion (JIT + attribute role mapping)', async () => {
    const begin = await start(detail.id);
    const url = new URL(begin.location);
    expect(url.origin + url.pathname).toBe(idp.ssoUrl);
    expect(url.searchParams.get('Signature')).toBeTruthy();
    expect(url.searchParams.get('SigAlg')).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    );

    const response = await idp.response({
      acsUrl: detail.endpoints.acsUrls[0] ?? '',
      audience: detail.endpoints.entityId,
      inResponseTo: begin.requestId,
      nameId: 'saml-user-1',
      attributes: {
        email: [`grace@${slug}.test`],
        displayName: ['Grace'],
        groups: ['designers', 'x'],
      },
    });
    const res = await acs(detail.id, response, begin.relayState, begin.tx);
    expect(res.statusCode, res.body).toBe(302);
    expect(res.headers.location).toBe(`${ADMIN_ORIGIN}/scripts`);
    const session = sessionOf(res);
    expect(session).toBeDefined();
    const me = await app.inject({
      method: 'GET',
      url: '/v1/authz/me',
      headers: { cookie: cookieHeader({ [SESSION]: session ?? '' }) },
    });
    expect(me.json<{ permissions: string[] }>().permissions).toContain('manage:Script');

    // The same assertion cannot be used twice, even with a fresh login transaction.
    const again = await start(detail.id);
    const replay = await acs(detail.id, response, again.relayState, again.tx);
    expect(replay.headers.location).toBe(`${ADMIN_ORIGIN}/?authError=login_failed`);
  });

  it.each([
    ['unsigned assertion', { sign: 'none' as const }],
    ['wrong audience', { audience: 'https://other-sp.example' }],
    ['wrong issuer', { issuer: 'https://evil.example/saml' }],
    ['expired assertion', { notOnOrAfter: new Date(Date.now() - 10 * 60_000) }],
    ['transient NameID', { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' }],
  ])('rejects a response with %s', async (_label, overrides) => {
    const begin = await start(detail.id);
    const response = await idp.response({
      acsUrl: detail.endpoints.acsUrls[0] ?? '',
      audience: detail.endpoints.entityId,
      inResponseTo: begin.requestId,
      attributes: { email: [`x@${slug}.test`] },
      ...overrides,
    });
    const res = await acs(detail.id, response, begin.relayState, begin.tx);
    expect(res.headers.location).toBe(`${ADMIN_ORIGIN}/?authError=login_failed`);
    expect(sessionOf(res)).toBeUndefined();
  });

  it('rejects an assertion signed by an untrusted key and one for another request', async () => {
    const attacker = await generateSpCredential('attacker');
    const begin = await start(detail.id);
    const forged = await idp.response({
      acsUrl: detail.endpoints.acsUrls[0] ?? '',
      audience: detail.endpoints.entityId,
      inResponseTo: begin.requestId,
      signingKey: attacker,
    });
    expect((await acs(detail.id, forged, begin.relayState, begin.tx)).headers.location).toContain(
      'authError=login_failed',
    );

    const other = await start(detail.id);
    const mismatched = await idp.response({
      acsUrl: detail.endpoints.acsUrls[0] ?? '',
      audience: detail.endpoints.entityId,
      inResponseTo: '_some-other-request',
    });
    expect(
      (await acs(detail.id, mismatched, other.relayState, other.tx)).headers.location,
    ).toContain('authError=login_failed');
  });

  it('refuses IdP-initiated (unsolicited) responses unless the tenant enables them', async () => {
    const unsolicited = await idp.response({
      acsUrl: detail.endpoints.acsUrls[0] ?? '',
      audience: detail.endpoints.entityId,
      nameId: 'idp-init',
    });
    const denied = await acs(detail.id, unsolicited);
    expect(denied.statusCode).toBe(302);
    expect(sessionOf(denied)).toBeUndefined();
    const audit = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'identity.login.failed' },
      orderBy: { seq: 'desc' },
    });
    expect(audit?.diff).toMatchObject({
      after: { reason: 'unsolicited_response', protocol: 'saml' },
    });

    const open = await createIdp({ allowIdpInitiated: true });
    const allowed = await idp.response({
      acsUrl: open.endpoints.acsUrls[0] ?? '',
      audience: open.endpoints.entityId,
      nameId: 'idp-init',
      attributes: { email: [`idp-init@${slug}.test`] },
    });
    const res = await acs(open.id, allowed, 'admin');
    expect(res.headers.location).toBe(`${ADMIN_ORIGIN}/`);
    expect(sessionOf(res)).toBeDefined();
  });
});

describe('SAML encrypted assertions and certificate rotation', () => {
  it('requires encryption when configured and decrypts with active and retired keys', async () => {
    let detail = await createIdp({ requireEncryptedAssertions: true });
    const encryptionCert = () =>
      detail.config.spCredentials.find((c) => c.use === 'encryption' && c.state === 'active')
        ?.certificate ?? '';
    const login = async (encryptFor: string | undefined, nameId: string) => {
      const begin = await start(detail.id);
      const response = await idp.response({
        acsUrl: detail.endpoints.acsUrls[0] ?? '',
        audience: detail.endpoints.entityId,
        inResponseTo: begin.requestId,
        nameId,
        attributes: { email: [`${nameId}@${slug}.test`] },
        ...(encryptFor === undefined ? {} : { encryptFor }),
      });
      return acs(detail.id, response, begin.relayState, begin.tx);
    };

    expect(sessionOf(await login(undefined, 'plain'))).toBeUndefined();
    const oldCert = encryptionCert();
    expect(sessionOf(await login(oldCert, 'enc-1'))).toBeDefined();

    // Rotation: next credential is published, then promoted; the old key still decrypts.
    const rotated = await app.inject({
      method: 'POST',
      url: `/v1/identity-providers/${detail.id}/sp-credentials`,
      headers: await tenant.auth(),
      payload: { use: 'encryption' },
    });
    expect(rotated.statusCode, rotated.body).toBe(201);
    detail = rotated.json<IdpDetail>();
    const next = detail.config.spCredentials.find((c) => c.state === 'next');
    const metadata = await app.inject({
      method: 'GET',
      url: `/auth/saml/${slug}/${detail.id}/metadata`,
    });
    expect(metadata.body.match(/<md:KeyDescriptor use="encryption">/g)).toHaveLength(2);

    const promoted = await app.inject({
      method: 'POST',
      url: `/v1/identity-providers/${detail.id}/sp-credentials/${next?.id ?? ''}/promote`,
      headers: await tenant.auth(),
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    detail = promoted.json<IdpDetail>();
    expect(
      detail.config.spCredentials
        .filter((c) => c.use === 'encryption')
        .map((c) => c.state)
        .sort(),
    ).toEqual(['active', 'retired']);
    expect(sessionOf(await login(encryptionCert(), 'enc-2'))).toBeDefined();
    expect(sessionOf(await login(oldCert, 'enc-3'))).toBeDefined();

    const retired = detail.config.spCredentials.find((c) => c.state === 'retired');
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/identity-providers/${detail.id}/sp-credentials/${retired?.id ?? ''}`,
      headers: await tenant.auth(),
    });
    expect(removed.statusCode).toBe(200);
    expect(sessionOf(await login(oldCert, 'enc-4'))).toBeUndefined();
    const audit = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId, action: { startsWith: 'identity.spCredential.' } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'identity.spCredential.created',
      'identity.spCredential.promoted',
      'identity.spCredential.removed',
    ]);
  });
});

describe('SAML single logout', () => {
  it('IdP-initiated LogoutRequest ends the session; SP-initiated logout redirects to the IdP', async () => {
    const detail = await createIdp();
    const signIn = async (nameId: string) => {
      const begin = await start(detail.id);
      const response = await idp.response({
        acsUrl: detail.endpoints.acsUrls[0] ?? '',
        audience: detail.endpoints.entityId,
        inResponseTo: begin.requestId,
        nameId,
        attributes: { email: [`${nameId}@${slug}.test`] },
      });
      return sessionOf(await acs(detail.id, response, begin.relayState, begin.tx)) ?? '';
    };
    const info = (session: string) =>
      app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: cookieHeader({ [SESSION]: session }) },
      });

    const first = await signIn('slo-user');
    const request = idp.logoutRequest({
      destination: `${ADMIN_ORIGIN}/api/auth/saml/${slug}/${detail.id}/slo`,
      nameId: 'slo-user',
      sessionIndex: '_s1',
    });
    const slo = await app.inject({
      method: 'POST',
      url: `/auth/saml/${slug}/${detail.id}/slo`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ SAMLRequest: request, RelayState: 'admin' }).toString(),
    });
    expect(slo.statusCode, slo.body).toBe(302);
    expect(String(slo.headers.location).startsWith(`${idp.sloUrl}?SAMLResponse=`)).toBe(true);
    expect((await info(first)).statusCode).toBe(401);

    const second = await signIn('slo-user-2');
    const csrf = (await info(second)).json<{ csrfToken: string }>().csrfToken;
    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: cookieHeader({ [SESSION]: second }),
        origin: ADMIN_ORIGIN,
        'x-csrf-token': csrf,
      },
    });
    expect(out.statusCode, out.body).toBe(200);
    expect(
      out.json<{ redirectUrl: string }>().redirectUrl.startsWith(`${idp.sloUrl}?SAMLRequest=`),
    ).toBe(true);
    expect((await info(second)).statusCode).toBe(401);
  });
});
