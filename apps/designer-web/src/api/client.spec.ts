import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, request, loginUrl, session } from './client.js';

afterEach(() => vi.unstubAllGlobals());
it('uses same-origin cookies, CSRF and idempotency headers without tokens', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"id":"ok"}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await request('/v1/scripts', z.object({ id: z.string() }), {
    method: 'POST',
    body: { name: 'Synthetic' },
    csrf: 'fixture-csrf',
    idempotencyKey: 'fixture-key',
  });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/scripts',
    expect.objectContaining({
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': 'fixture-csrf',
        'idempotency-key': 'fixture-key',
      },
    }),
  );
});
it('rejects invalid response shapes and absolute or traversal paths', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  await expect(request('/v1/scripts', z.object({ id: z.string() }))).rejects.toMatchObject({
    code: 'VERBIS_RESPONSE_INVALID',
  });
  for (const path of ['https://evil.test/a', '/v1/../auth/session'])
    await expect(request(path, z.unknown())).rejects.toBeInstanceOf(ApiError);
});
it('distinguishes unauthenticated sessions from unavailable infrastructure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{}', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(session(new AbortController().signal)).resolves.toBeNull();
  await expect(session(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
});
it('uses the fixed designer SSO destination', () => {
  const url = new URL(loginUrl('tenant', 'idp'), 'https://example.test');
  expect(url.pathname).toBe('/api/auth/login');
  expect(url.searchParams.get('app')).toBe('designer');
  expect(url.searchParams.get('returnTo')).toBe('/');
});
