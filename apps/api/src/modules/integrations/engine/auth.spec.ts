import { createHmac, createHash } from 'node:crypto';

import nock from 'nock';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Authentication } from './auth.js';
import { PolicySchema, type Auth, type WireRequest } from './contracts.js';
import { createSecureTransport } from './transport.js';

const ref = '00000000-0000-4000-8000-000000000001';
const origin = 'https://service.test';
const policy = PolicySchema.parse({ allowedOrigins: [origin] });
const transport = createSecureTransport(() =>
  Promise.resolve([{ address: '93.184.215.14', family: 4 }]),
);
const read = (value: string, version = 1) => vi.fn(() => Promise.resolve({ value, version }));
const request = (): WireRequest => ({
  url: new URL(`${origin}/api`),
  method: 'POST',
  headers: {},
  body: '{}',
});
const signal = () => AbortSignal.timeout(1000);
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  vi.useRealTimers();
});
describe('authentication strategies', () => {
  it.each([
    [{ type: 'none' }, '', undefined],
    [{ type: 'bearer', secretRef: ref }, 'fixture-bearer', 'Bearer fixture-bearer'],
    [
      { type: 'basic', secretRef: ref },
      JSON.stringify({ username: 'fixture', password: 'synthetic' }),
      `Basic ${Buffer.from('fixture:synthetic').toString('base64')}`,
    ],
  ] as [Auth, string, string | undefined][])(
    'constructs %j authentication',
    async (auth, value, expected) => {
      nock.disableNetConnect();
      const wire = request();
      const reader = read(value);
      await new Authentication(transport).apply(
        'tenant-a',
        auth,
        wire,
        reader,
        policy,
        [origin],
        signal(),
      );
      expect(wire.headers['Authorization']).toBe(expected);
      const scope = nock(origin).post('/api').reply(200, '{}');
      await transport(wire, policy, [origin], signal());
      expect(scope.isDone()).toBe(true);
      expect(reader).toHaveBeenCalledTimes(auth.type === 'none' ? 0 : 1);
    },
  );
  it.each(['header', 'query'] as const)('injects API key into %s', async (placement) => {
    nock.disableNetConnect();
    const wire = request();
    await new Authentication(transport).apply(
      'tenant-a',
      { type: 'apiKey', secretRef: ref, placement, name: 'X-Api-Key' },
      wire,
      read('synthetic'),
      policy,
      [origin],
      signal(),
    );
    expect(
      placement === 'header' ? wire.headers['X-Api-Key'] : wire.url.searchParams.get('X-Api-Key'),
    ).toBe('synthetic');
    const scope = nock(origin).post('/api').query(true).reply(200, '{}');
    await transport(wire, policy, [origin], signal());
    expect(scope.isDone()).toBe(true);
  });
  it.each(['oauth2-client-credentials', 'oauth2-password'] as const)(
    'obtains, caches and refreshes %s tokens',
    async (type) => {
      nock.disableNetConnect();
      const auth = new Authentication(transport);
      const strategy: Auth = { type, secretRef: ref, tokenUrl: `${origin}/token` };
      const secret = read(
        JSON.stringify({
          clientId: 'fixture',
          clientSecret: 'synthetic',
          username: 'fixture',
          password: 'synthetic',
        }),
      );
      const first = nock(origin)
        .post(
          '/token',
          (body: Record<string, string>) =>
            body['grant_type'] === (type === 'oauth2-password' ? 'password' : 'client_credentials'),
        )
        .reply(200, { access_token: 'synthetic-one', expires_in: 3600 });
      const wire = request();
      await auth.apply('tenant-a', strategy, wire, secret, policy, [origin], signal());
      expect(wire.headers['Authorization']).toBe('Bearer synthetic-one');
      expect(first.isDone()).toBe(true);
      await auth.apply('tenant-a', strategy, request(), secret, policy, [origin], signal());
      auth.invalidate('tenant-a');
      const second = nock(origin)
        .post('/token')
        .reply(200, { access_token: 'synthetic-two', expires_in: 3600 });
      await auth.apply('tenant-a', strategy, wire, secret, policy, [origin], signal());
      expect(wire.headers['Authorization']).toBe('Bearer synthetic-two');
      expect(second.isDone()).toBe(true);
    },
  );
  it('separates OAuth token caches by tenant and secret version', async () => {
    nock.disableNetConnect();
    const auth = new Authentication(transport);
    const strategy: Auth = {
      type: 'oauth2-client-credentials',
      secretRef: ref,
      tokenUrl: `${origin}/token`,
    };
    const scope = nock(origin)
      .post('/token')
      .times(3)
      .reply(200, { access_token: 'synthetic', expires_in: 3600 });
    for (const [tenant, version] of [
      ['a', 1],
      ['b', 1],
      ['a', 2],
    ] as const)
      await auth.apply(
        tenant,
        strategy,
        request(),
        read(JSON.stringify({ clientId: 'fixture', clientSecret: 'synthetic' }), version),
        policy,
        [origin],
        signal(),
      );
    expect(scope.isDone()).toBe(true);
  });
  it('provides mTLS material only to server transport', async () => {
    const wire = request();
    await new Authentication(transport).apply(
      'tenant-a',
      { type: 'mtls', secretRef: ref },
      wire,
      read(JSON.stringify({ cert: 'synthetic-cert', key: 'synthetic-key' })),
      policy,
      [origin],
      signal(),
    );
    expect(wire.tls).toEqual({ cert: 'synthetic-cert', key: 'synthetic-key' });
    expect(wire.headers).toEqual({});
  });
  it('signs method, target, timestamp, nonce and body with HMAC SHA-256', async () => {
    const wire = request();
    await new Authentication(transport).apply(
      'tenant-a',
      { type: 'hmac', secretRef: ref, header: 'X-Signature' },
      wire,
      read('synthetic'),
      policy,
      [origin],
      signal(),
    );
    const canonical = [
      'POST',
      '/api',
      wire.headers['X-Signature-Timestamp'],
      wire.headers['X-Signature-Nonce'],
      createHash('sha256').update('{}').digest('hex'),
    ].join('\n');
    expect(wire.headers['X-Signature']).toBe(
      createHmac('sha256', 'synthetic').update(canonical).digest('base64'),
    );
  });
  it('generates WS-Security nonce, timestamp and digest without plaintext password', async () => {
    const result = await new Authentication(transport).apply(
      'tenant-a',
      { type: 'wsSecurity', secretRef: ref },
      request(),
      read(JSON.stringify({ username: '<fixture>', password: 'synthetic-password' })),
      policy,
      [origin],
      signal(),
    );
    expect(result.security).toContain('&lt;fixture&gt;');
    expect(result.security).toContain('PasswordDigest');
    expect(result.security).toContain('wsse:Nonce');
    expect(result.security).not.toContain('synthetic-password');
  });
});
