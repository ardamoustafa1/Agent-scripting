import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ConnectorError } from '@verbis/sdk-connector';

import { AxpClient } from './axp-client.js';

const schema = z.object({ value: z.string() });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(
  replies: (Response | Error)[],
  options: { global?: boolean; realSleep?: boolean; now?: () => Date; random?: () => number } = {},
) {
  const request = vi.fn<typeof fetch>().mockImplementation(() => {
    const reply = replies.shift();
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve(reply ?? Response.json({ value: 'ok' }));
  });
  const sleep = vi.fn().mockResolvedValue(undefined);
  if (options.global) vi.stubGlobal('fetch', request);
  const client = new AxpClient(
    { host: 'na.api.avayacloud.com', accountId: 'synthetic' },
    () => Promise.resolve({ clientId: 'id', clientSecret: 'secret', appKey: 'key' }),
    {
      ...(options.global ? {} : { fetch: request }),
      ...(options.realSleep ? {} : { sleep }),
      ...(options.now ? { now: options.now } : {}),
      ...(options.random ? { random: options.random } : {}),
    },
  );
  return { client, request, sleep };
}
const token = () => Response.json({ access_token: 'synthetic', expires_in: 900 });
it('deduplicates concurrent token requests, refreshes before expiry, and encodes client credentials', async () => {
  let now = new Date('2026-10-03T10:00:00Z');
  const f = setup([token(), token()], { now: () => now });
  expect(await Promise.all([f.client.token(), f.client.token()])).toEqual([
    'synthetic',
    'synthetic',
  ]);
  expect(f.request).toHaveBeenCalledOnce();
  expect(new URLSearchParams(f.request.mock.calls[0]?.[1]?.body as string).get('grant_type')).toBe(
    'client_credentials',
  );
  now = new Date(now.getTime() + 839000);
  await f.client.token();
  expect(f.request).toHaveBeenCalledOnce();
  now = new Date(now.getTime() + 1000);
  await f.client.token();
  expect(f.request).toHaveBeenCalledTimes(2);
});
it('rejects invalid paths before fetching and uses strict redirects, app keys and bounded abort signals', async () => {
  const f = setup([token(), Response.json({ value: 'accepted' })]);
  await expect(f.client.request('GET', 'https://evil.test/', schema)).rejects.toMatchObject({
    code: 'axp_bad_path',
  });
  expect(f.request).not.toHaveBeenCalled();
  await expect(
    f.client.request('PUT', '/api/resource', schema, { field: 'synthetic' }),
  ).resolves.toEqual({ value: 'accepted' });
  const init = f.request.mock.calls[1]?.[1];
  expect(init?.redirect).toBe('error');
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.body).toBe('{"field":"synthetic"}');
  const headers = new Headers(init?.headers);
  expect(headers.get('appkey')).toBe('key');
  expect(headers.get('authorization')).toBe('Bearer synthetic');
  expect(headers.get('content-type')).toBe('application/json');
});
it('refreshes once on unauthorized responses then refuses a repeated unauthorized response', async () => {
  const f = setup([
    token(),
    new Response(null, { status: 401 }),
    token(),
    new Response(null, { status: 401 }),
  ]);
  await expect(f.client.request('GET', '/api/resource', schema)).rejects.toMatchObject({
    code: 'axp_bad_request',
    retryable: false,
  });
  expect(f.request).toHaveBeenCalledTimes(4);
});
it.each([
  [404, 'axp_not_found'],
  [400, 'axp_bad_request'],
  [503, 'axp_unavailable'],
])('classifies non-idempotent HTTP %s failures without retrying', async (status, code) => {
  const f = setup([token(), new Response(null, { status })]);
  await expect(f.client.request('POST', '/api/resource', schema, {})).rejects.toMatchObject({
    code,
  });
  expect(f.sleep).not.toHaveBeenCalled();
  expect(f.request).toHaveBeenCalledTimes(2);
});
it.each([429, 503])('limits retry attempts on repeated HTTP %s failures', async (status) => {
  const f = setup([token(), ...Array.from({ length: 4 }, () => new Response(null, { status }))], {
    random: () => 0.5,
  });
  await expect(f.client.request('GET', '/api/resource', schema)).rejects.toMatchObject({
    code: status === 429 ? 'axp_rate_limited' : 'axp_unavailable',
    retryable: true,
  });
  expect(f.sleep).toHaveBeenCalledTimes(3);
  expect(f.request).toHaveBeenCalledTimes(5);
});
it('honors Retry-After and uses default fetch and timed backoff when no adapters are supplied', async () => {
  vi.useFakeTimers();
  const f = setup(
    [
      token(),
      new Response(null, { status: 429, headers: { 'retry-after': '2' } }),
      Response.json({ value: 'ok' }),
    ],
    { global: true, realSleep: true },
  );
  const result = f.client.request('GET', '/api/resource', schema);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ value: 'ok' });
});
it('retries network errors for idempotent requests and avoids retrying a potentially committed POST', async () => {
  const f = setup([token(), new Error('synthetic network'), Response.json({ value: 'ok' })]);
  await expect(f.client.request('GET', '/api/resource', schema)).resolves.toEqual({ value: 'ok' });
  expect(f.sleep).toHaveBeenCalledOnce();
  const post = setup([token(), new Error('synthetic network')]);
  await expect(post.client.request('POST', '/api/resource', schema, {})).rejects.toMatchObject({
    code: 'axp_unavailable',
  });
  expect(post.sleep).not.toHaveBeenCalled();
  const exhausted = setup([
    token(),
    ...Array.from({ length: 4 }, () => new Error('synthetic network')),
  ]);
  await expect(exhausted.client.request('GET', '/api/resource', schema)).rejects.toMatchObject({
    code: 'axp_unavailable',
  });
  expect(exhausted.sleep).toHaveBeenCalledTimes(3);
});
it('preserves structured connector errors and rejects invalid successful response bodies', async () => {
  const error = new ConnectorError('safe error', 'synthetic', false),
    f = setup([token(), error]);
  await expect(f.client.request('GET', '/api/resource', schema)).rejects.toBe(error);
  expect(f.sleep).not.toHaveBeenCalled();
  for (const response of [new Response('{broken'), Response.json({ unexpected: true })]) {
    const bad = setup([token(), response]);
    await expect(bad.client.request('GET', '/api/resource', schema)).rejects.toMatchObject({
      code: 'axp_bad_response',
    });
  }
  const noContent = setup([token(), new Response(null, { status: 204 })]);
  await expect(
    noContent.client.request('DELETE', '/api/resource', z.undefined()),
  ).resolves.toBeUndefined();
});
it.each([
  new Error('network'),
  new Response(null, { status: 401 }),
  new Response(null, { status: 500 }),
  new Response(null, { status: 429 }),
  new Response('{invalid'),
  Response.json({ access_token: 'invalid', expires_in: 0 }),
])('fails authentication safely and can retry after a token failure', async (response) => {
  const f = setup([response, token()]);
  await expect(f.client.token()).rejects.toMatchObject({
    code: response instanceof Error ? 'axp_unavailable' : 'axp_auth_failed',
  });
  await expect(f.client.token()).resolves.toBe('synthetic');
});
