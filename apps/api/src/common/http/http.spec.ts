import { describe, expect, it, vi } from 'vitest';

import { PreconditionRequiredError, VersionMismatchError } from '../errors/domain-errors.js';

import { TenantOriginPolicy } from './cors.js';
import { etagFor, expectedVersion, setEtag } from './if-match.js';
import { rateLimitKey } from './rate-limit.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const request = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;

describe('If-Match', () => {
  it('parses strong and weak validators', () => {
    expect(expectedVersion(request({ 'if-match': '"3"' }))).toBe(3);
    expect(expectedVersion(request({ 'if-match': ' W/"12" ' }))).toBe(12);
  });

  it('requires the header and a numeric version', () => {
    expect(() => expectedVersion(request({}))).toThrow(PreconditionRequiredError);
    for (const value of ['3', '"abc"', '"0"', '*'])
      expect(() => expectedVersion(request({ 'if-match': value }))).toThrow(VersionMismatchError);
  });

  it('formats ETags', () => {
    const header = vi.fn();
    setEtag({ header } as unknown as FastifyReply, 4);
    expect(header).toHaveBeenCalledWith('etag', '"4"');
    expect(etagFor(1)).toBe('"1"');
  });
});

describe('TenantOriginPolicy', () => {
  it('allows static origins without a lookup', async () => {
    const lookup = vi.fn().mockResolvedValue(false);
    const policy = new TenantOriginPolicy(['https://app.verbis.io'], lookup);
    expect(await policy.isAllowed('https://app.verbis.io')).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('caches tenant lookups and expires them', async () => {
    let now = 0;
    const lookup = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const policy = new TenantOriginPolicy([], lookup, 1_000, () => now);
    expect(await policy.isAllowed('https://acme.example')).toBe(true);
    expect(await policy.isAllowed('https://acme.example')).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 2_000;
    expect(await policy.isAllowed('https://acme.example')).toBe(false);
  });

  it('rejects malformed origins and fails closed on lookup errors', async () => {
    const policy = new TenantOriginPolicy([], () => Promise.reject(new Error('db down')));
    expect(await policy.isAllowed('null')).toBe(false);
    expect(await policy.isAllowed('https://evil.example/path')).toBe(false);
    expect(await policy.isAllowed('https://acme.example')).toBe(false);
  });

  it('bounds the cache', async () => {
    const policy = new TenantOriginPolicy([], () => Promise.resolve(true));
    for (let i = 0; i < 10_002; i += 1) await policy.isAllowed(`https://h${String(i)}.example`);
    expect(await policy.isAllowed('https://h0.example')).toBe(true);
  });
});

describe('rateLimitKey', () => {
  it('keys by tenant and principal, else by IP', () => {
    expect(rateLimitKey({ ip: '10.0.0.1' } as FastifyRequest)).toBe('ip:10.0.0.1');
    const principal = { type: 'user', id: 'u1', tenantId: 't1', scopes: [] };
    expect(rateLimitKey({ ip: '10.0.0.1', principal } as unknown as FastifyRequest)).toBe(
      't:t1:user:u1',
    );
  });
});
