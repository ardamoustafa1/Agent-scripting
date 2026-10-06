import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { amzDate, S3WormClient, signS3Request, type S3WormConfig } from './s3-worm.client.js';

const config: S3WormConfig = {
  endpoint: 'https://s3.example.test',
  region: 'eu-central-1',
  bucket: 'verbis-audit',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  mode: 'COMPLIANCE',
};
const now = new Date('2026-10-01T12:34:56.789Z');

describe('S3 WORM client', () => {
  it('formats SigV4 dates', () => {
    expect(amzDate(now)).toEqual({ stamp: '20261001T123456Z', day: '20261001' });
  });

  it('signs deterministically and binds the object-lock headers into the signature', () => {
    const a = signS3Request(
      config,
      'PUT',
      'audit/t/a b.ndjson.gz',
      'e'.repeat(64),
      { 'x-amz-object-lock-mode': 'COMPLIANCE' },
      now,
    );
    const b = signS3Request(
      config,
      'PUT',
      'audit/t/a b.ndjson.gz',
      'e'.repeat(64),
      { 'x-amz-object-lock-mode': 'COMPLIANCE' },
      now,
    );
    const c = signS3Request(
      config,
      'PUT',
      'audit/t/a b.ndjson.gz',
      'e'.repeat(64),
      { 'x-amz-object-lock-mode': 'GOVERNANCE' },
      now,
    );
    expect(a).toEqual(b);
    expect(a.url).toBe('https://s3.example.test/verbis-audit/audit/t/a%20b.ndjson.gz');
    expect(a.headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261001\/eu-central-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-object-lock-mode, Signature=[0-9a-f]{64}$/,
    );
    expect(a.headers['authorization']).not.toBe(c.headers['authorization']);
  });

  it('uploads with COMPLIANCE lock, retain-until, Content-MD5 and no-overwrite', async () => {
    const fetcher = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const body = new TextEncoder().encode('line\n');
    await new S3WormClient(config, fetcher, () => now).putLocked(
      'k',
      body,
      new Date('2036-01-01T00:00:00Z'),
      'application/gzip',
    );
    const headers = fetcher.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers).toMatchObject({
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': '2036-01-01T00:00:00.000Z',
      'content-md5': createHash('md5').update(body).digest('base64'),
      'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
      'if-none-match': '*',
    });
    expect(headers['host']).toBeUndefined();
  });

  it('reads back body and lock headers; surfaces HTTP failures', async () => {
    const ok = vi.fn(() =>
      Promise.resolve(
        new Response('abc', {
          status: 200,
          headers: {
            'x-amz-object-lock-mode': 'COMPLIANCE',
            'x-amz-object-lock-retain-until-date': '2036-01-01T00:00:00Z',
          },
        }),
      ),
    );
    const got = await new S3WormClient(config, ok, () => now).get('k');
    expect(new TextDecoder().decode(got.body)).toBe('abc');
    expect(got.lockMode).toBe('COMPLIANCE');
    const fail = vi.fn(() => Promise.resolve(new Response(null, { status: 403 })));
    await expect(new S3WormClient(config, fail).get('k')).rejects.toThrow('403');
    await expect(
      new S3WormClient(config, fail).putLocked('k', new Uint8Array(), now, 'x'),
    ).rejects.toThrow('403');
  });
});
