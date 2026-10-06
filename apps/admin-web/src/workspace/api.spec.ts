import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';

import { createAbility } from '@verbis/authz';

import { allowed } from './access.js';
import { request, ListSchema, AdminApiError } from './api.js';

afterEach(() => vi.unstubAllGlobals());
describe('admin BFF transport', () => {
  it('uses the cookie, CSRF and an optimistic-lock version, without storing credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'fixture' })));
    vi.stubGlobal('fetch', fetcher);
    await request('/v1/secrets/fixture', z.object({ id: z.string() }), {
      method: 'PUT',
      body: { value: 'ephemeral-fixture' },
      csrf: 'fixture-csrf',
      version: 3,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/secrets/fixture');
    const options: unknown = fetcher.mock.calls[0]?.[1];
    const parsed = z
      .object({
        credentials: z.string(),
        cache: z.string(),
        headers: z.record(z.string(), z.string()),
      })
      .parse(options);
    expect(parsed.credentials).toBe('same-origin');
    expect(parsed.cache).toBe('no-store');
    expect(parsed.headers['x-csrf-token']).toBe('fixture-csrf');
    expect(parsed.headers['if-match']).toBe('"3"');
  });
  it('preserves API error codes and correlation IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'VERBIS_VERSION_MISMATCH',
            correlationId: 'fixture-correlation',
          }),
          { status: 412 },
        ),
      ),
    );
    await expect(request('/v1/tenant', z.unknown())).rejects.toMatchObject({
      code: 'VERBIS_VERSION_MISMATCH',
      correlationId: 'fixture-correlation',
    });
    expect(new AdminApiError('fixture')).toBeInstanceOf(Error);
  });
  it('handles keyset pages and rejects a SPA fallback', () => {
    const parsed = ListSchema.parse({ data: [{ id: 'fixture' }], page: { nextCursor: 'next' } });
    expect(parsed.page?.nextCursor).toBe('next');
    expect(ListSchema.safeParse('<html/>').success).toBe(false);
  });
  it('shows canonical and legacy subject names using CASL, including manage all and denies', () => {
    const admin = createAbility([{ action: 'manage', subject: 'all' }]);
    expect(allowed(admin, 'manage', 'IdentityProvider')).toBe(true);
    const denied = createAbility([
      { action: 'manage', subject: 'all' },
      { action: 'manage', subject: 'Secret', inverted: true },
    ]);
    expect(allowed(denied, 'manage', 'Secret')).toBe(false);
    expect(allowed(null, 'manage', 'Tenant')).toBe(false);
  });
});
