import { exportJWK, generateKeyPair, jwtVerify } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HUB_AUDIENCE, HUB_ISSUER, HubClient } from './hub-client.js';

import type { ApiEnv } from '../../env.js';

let keys: Awaited<ReturnType<typeof generateKeyPair>>, jwk: string;
beforeAll(async () => {
  keys = await generateKeyPair('EdDSA', { extractable: true });
  jwk = JSON.stringify({ ...(await exportJWK(keys.privateKey)), kid: 'synthetic-hub-key' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const schema = z.strictObject({ ok: z.boolean() });
const client = (key = jwk, url = 'https://synthetic-hub.test') =>
  new HubClient({ CONNECTOR_HUB_URL: url, INTERNAL_JWT_SIGNING_JWK: key } as ApiEnv);

describe('connector hub authenticated transport', () => {
  it('signs distinct short-lived tenant grants and sends validated POST and GET requests', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    const hub = client();
    expect(hub.configured).toBe(true);
    expect(
      await hub.call('synthetic-tenant', 'POST', '/connectors', schema, { connector: 'synthetic' }),
    ).toEqual({ ok: true });
    await hub.call('other-tenant', 'GET', '/health', schema);
    const claims = [];
    for (const call of fetcher.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      const token = headers.get('authorization')?.slice(7) ?? '';
      const verified = await jwtVerify(token, keys.publicKey, {
        audience: HUB_AUDIENCE,
        issuer: HUB_ISSUER,
      });
      expect(verified.protectedHeader).toMatchObject({ alg: 'EdDSA', kid: 'synthetic-hub-key' });
      expect(verified.payload).toMatchObject({
        typ: 'service',
        scp: ['manage:Connector'],
        sub: 'verbis-api',
      });
      expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(60);
      expect(call[1]?.redirect).toBe('error');
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
      claims.push(verified.payload);
    }
    expect(claims.map((claim) => claim['tnt'])).toEqual(['synthetic-tenant', 'other-tenant']);
    expect(claims[0]?.jti).not.toBe(claims[1]?.jti);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe('{"connector":"synthetic"}');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(fetcher.mock.calls[1]?.[1]).not.toHaveProperty('body');
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('content-type')).toBeNull();
  });
  it.each([
    { url: '', key: undefined },
    { url: 'https://synthetic-hub.test', key: undefined },
    { url: '', key: 'synthetic' },
  ])('fails closed for missing configuration (%j)', async ({ url, key }) => {
    const hub = new HubClient({
      CONNECTOR_HUB_URL: url,
      ...(key === undefined ? {} : { INTERNAL_JWT_SIGNING_JWK: key }),
    } as ApiEnv);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(hub.configured).toBe(false);
    await expect(hub.call('tenant', 'GET', '/health', schema)).rejects.toMatchObject({
      code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    {
      status: 409,
      body: { code: 'VERBIS_CONNECTOR_CONCURRENCY_LIMIT', detail: 'secret' },
      code: 'VERBIS_CONNECTOR_CONCURRENCY_LIMIT',
    },
    { status: 403, body: {}, code: 'VERBIS_CONNECTOR_ACCESS_DENIED' },
    { status: 429, body: {}, code: 'VERBIS_CONNECTOR_RATE_LIMITED' },
    { status: 404, body: { code: 'remote-secret-detail' }, code: 'VERBIS_RESOURCE_NOT_FOUND' },
    {
      status: 400,
      body: { code: 'synthetic-validation' },
      code: 'VERBIS_CONNECTOR_PAYLOAD_REJECTED',
    },
    { status: 422, body: {}, code: 'VERBIS_CONNECTOR_PAYLOAD_REJECTED' },
    {
      status: 503,
      body: { secret: 'remote-secret-detail' },
      code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    },
  ])(
    'maps status $status without exposing arbitrary upstream payloads',
    async ({ status, body, code }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(Response.json(body, { status }))),
      );
      await expect(client().call('tenant', 'GET', '/health', schema)).rejects.toMatchObject({
        code,
      });
    },
  );
  it.each(['network', 'invalid JSON', 'invalid schema'] as const)(
    'fails closed for %s',
    async (reason) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() =>
            reason === 'network'
              ? Promise.reject(new Error('synthetic network error with secret'))
              : Promise.resolve(
                  reason === 'invalid JSON'
                    ? new Response('broken JSON')
                    : Response.json({ ok: 'invalid' }),
                ),
          ),
      );
      await expect(client().call('tenant', 'GET', '/health', schema)).rejects.toMatchObject({
        code: 'VERBIS_INTEGRATION_UNAVAILABLE',
      });
    },
  );
  it('rejects a signing key without a key id before sending any authenticated request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(client('{}').call('tenant', 'GET', '/health', schema)).rejects.toThrow(
      'needs a kid',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
