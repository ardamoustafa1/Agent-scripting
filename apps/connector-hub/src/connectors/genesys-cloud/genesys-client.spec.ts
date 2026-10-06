import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConnectorError } from '@verbis/sdk-connector';

import { FakeGenesys } from '../../test/fake-genesys.js';

import { GenesysCloudClient, retryAfterMs } from './genesys-client.js';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const creds = () => Promise.resolve({ clientId: 'id', clientSecret: 'secret' });

describe('genesys cloud client', () => {
  it('parses Retry-After seconds and HTTP dates, capped at 60 s', () => {
    expect(retryAfterMs('2', NOW)).toBe(2_000);
    expect(retryAfterMs('600', NOW)).toBe(60_000);
    expect(retryAfterMs('Thu, 01 Oct 2026 10:00:05 GMT', NOW)).toBe(5_000);
    expect(retryAfterMs(null, NOW)).toBeUndefined();
    expect(retryAfterMs('soon', NOW)).toBeUndefined();
  });

  it('uses the region hosts and Basic auth for client credentials', async () => {
    const fake = new FakeGenesys(undefined, 'mypurecloud.com.au');
    const client = new GenesysCloudClient('ap-southeast-2', creds, {
      fetch: fake.fetch,
      now: () => NOW,
    });
    await expect(
      client.request('GET', '/api/v2/conversations/abc', z.unknown()),
    ).rejects.toMatchObject({ code: 'genesys_not_found' });
    expect(fake.calls[0]?.url).toBe('https://login.mypurecloud.com.au/oauth/token');
    expect(fake.calls[0]?.authorization).toBe(
      `Basic ${Buffer.from('id:secret').toString('base64')}`,
    );
    expect(fake.calls[1]?.url).toBe('https://api.mypurecloud.com.au/api/v2/conversations/abc');
  });

  it('refuses paths outside /api/v2 and never retries non-idempotent POSTs on 5xx', async () => {
    const fake = new FakeGenesys();
    const client = new GenesysCloudClient('eu-central-1', creds, {
      fetch: fake.fetch,
      sleep: () => Promise.resolve(),
    });
    await expect(client.request('GET', '/oauth/token', z.unknown())).rejects.toMatchObject({
      code: 'genesys_bad_path',
    });
    fake.failNext(502);
    await expect(
      client.request('POST', '/api/v2/notifications/channels', z.unknown(), { idempotent: false }),
    ).rejects.toBeInstanceOf(ConnectorError);
    expect(fake.requests('POST', /channels$/)).toHaveLength(1);
  });

  it('shares one in-flight token request and caches it until shortly before expiry', async () => {
    const fake = new FakeGenesys();
    let now = NOW.getTime();
    const client = new GenesysCloudClient('eu-central-1', creds, {
      fetch: fake.fetch,
      now: () => new Date(now),
    });
    await Promise.all(
      [1, 2, 3].map(() =>
        client.request('PUT', '/api/v2/notifications/channels/c/subscriptions', z.unknown(), {
          body: [],
        }),
      ),
    );
    expect(fake.tokenRequests).toBe(1);
    now += 86_400_000;
    await client.request('PUT', '/api/v2/notifications/channels/c/subscriptions', z.unknown(), {
      body: [],
    });
    expect(fake.tokenRequests).toBe(2);
  });
});
