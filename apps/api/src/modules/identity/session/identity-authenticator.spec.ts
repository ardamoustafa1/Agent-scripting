import { X509Certificate } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { testEnv } from '../../../../test/support/env.js';
import { sha256Base64Url } from '../crypto/random.js';
import { generateSpCredential } from '../saml/sp-credentials.js';

import { IdentityAuthenticator } from './identity-authenticator.js';

import type { FastifyRequest } from 'fastify';

describe('forwarded client certificate trust', () => {
  it('rejects direct spoofing, missing, duplicate and wrong edge proof; accepts the verified edge', async () => {
    const secret = 'edge-' + 'a'.repeat(32);
    const credential = await generateSpCredential('edge-test');
    const env = testEnv('{"keys":[{"kty":"OKP"}]}', {
      MTLS_CLIENT_CERT_HEADER: 'x-client-cert',
      MTLS_PROXY_SECRET: secret,
    });
    const dependencies = [env, {}, {}, {}, {}, {}, {}] as unknown as ConstructorParameters<
      typeof IdentityAuthenticator
    >;
    const auth = new IdentityAuthenticator(...dependencies);
    const headers = { 'x-client-cert': encodeURIComponent(credential.certificate) };
    for (const proof of [undefined, '', 'forged', [secret, secret]]) {
      expect(
        auth.clientCertificateThumbprint({
          headers: { ...headers, 'x-verbis-mtls-proxy-secret': proof },
        } as unknown as FastifyRequest),
      ).toBeUndefined();
    }
    expect(
      auth.clientCertificateThumbprint({
        headers: { 'x-client-cert': 'bad-pem', 'x-verbis-mtls-proxy-secret': secret },
      } as unknown as FastifyRequest),
    ).toBeUndefined();
    expect(
      auth.clientCertificateThumbprint({
        headers: { ...headers, 'x-verbis-mtls-proxy-secret': secret },
      } as unknown as FastifyRequest),
    ).toBe(sha256Base64Url(new X509Certificate(credential.certificate).raw));
  });
});
