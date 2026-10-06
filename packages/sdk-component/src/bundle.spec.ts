import { createHash, webcrypto } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkApproval, loadBundle, trustedSandboxDocument, verifyBundle } from './bundle.js';
import { PluginManifestSchema, type TenantApproval } from './protocol.js';

const bytes = new TextEncoder().encode('export const safe = 1;');
const integrity = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
const manifest = PluginManifestSchema.parse({
  type: 'acme.demo',
  version: '1.0.0',
  integrity,
  builtOn: ['box'],
  permissions: { props: [], write: [], events: [] },
});
const approval: TenantApproval = {
  tenantId: '01928f3a-0000-7000-8000-0000000000ff',
  type: manifest.type,
  version: manifest.version,
  integrity,
  enabled: true,
  bundleUrl: 'https://assets.example.test/a.js',
  approvedOrigins: ['https://assets.example.test'],
  expiresAt: 10_000,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('verified plugin transport', () => {
  it.each(['sha256', 'sha384', 'sha512'])(
    'verifies %s and rejects malformed or mismatched digests',
    async (algorithm) => {
      vi.stubGlobal('crypto', webcrypto);
      await expect(
        verifyBundle(bytes, `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`),
      ).resolves.toBeUndefined();
      await expect(verifyBundle(bytes, 'md5-AAAA')).rejects.toThrow('VERBIS_PLUGIN_INTEGRITY');
      await expect(verifyBundle(bytes, `${algorithm}-AAAA`)).rejects.toThrow(
        'VERBIS_PLUGIN_INTEGRITY',
      );
    },
  );
  it.each([
    { type: 'acme.other' },
    { integrity: `sha384-${'B'.repeat(64)}` },
    { expiresAt: 1000 },
    {
      bundleUrl: 'http://assets.example.test/a.js',
      approvedOrigins: ['http://assets.example.test'],
    },
    { bundleUrl: 'https://user:password@assets.example.test/a.js' },
  ])('rejects inconsistent approval %j', (patch) => {
    expect(() =>
      checkApproval({ ...approval, ...patch }, approval.tenantId, manifest, 1000),
    ).toThrow();
  });
  it('joins multiple stream chunks, verifies bytes and forwards the cancellation signal without credentials', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: bytes.slice(0, 5) })
      .mockResolvedValueOnce({ done: false, value: bytes.slice(5) })
      .mockResolvedValueOnce({ done: true });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
      body: { getReader: () => ({ read, cancel }) },
    });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(loadBundle(approval, signal)).resolves.toBe(
      `data:application/javascript;base64,${Buffer.from(bytes).toString('base64')}`,
    );
    expect(fetch).toHaveBeenCalledWith(approval.bundleUrl, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      mode: 'cors',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    { ok: false, body: {} },
    { ok: true, body: null },
  ])('rejects failed or bodyless fetches', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(loadBundle(approval, new AbortController().signal)).rejects.toThrow(
      'VERBIS_PLUGIN_BUNDLE_FETCH',
    );
  });
  it.each([null, 'text/html', 'application/json', 'text/javascript-malicious'])(
    'rejects MIME %s before reading',
    async (mime) => {
      const getReader = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, body: { getReader }, headers: { get: () => mime } }),
      );
      await expect(loadBundle(approval, new AbortController().signal)).rejects.toThrow(
        'VERBIS_PLUGIN_BUNDLE_TYPE',
      );
      expect(getReader).not.toHaveBeenCalled();
    },
  );
  it('cancels the reader on oversize and read failure', async () => {
    for (const read of [
      vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(1024 * 1024 + 1) }),
      vi.fn().mockRejectedValue(new Error('stream broken')),
    ]) {
      const cancel = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'text/ecmascript' }),
          body: { getReader: () => ({ read, cancel }) },
        }),
      );
      await expect(loadBundle(approval, new AbortController().signal)).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    }
  });
  it('allows only the locally generated document through the reusable Trusted Types policy', async () => {
    vi.resetModules();
    const module = await import('./bundle.js');
    let rule: ((input: string) => string) | undefined;
    const createPolicy = vi.fn(
      (_name: string, rules: { createHTML: (input: string) => string }) => {
        rule = rules.createHTML;
        return { createHTML: rules.createHTML };
      },
    );
    vi.stubGlobal('trustedTypes', { createPolicy });
    const bundle = `data:application/javascript;base64,${Buffer.from(bytes).toString('base64')}`;
    expect(module.trustedSandboxDocument(bundle)).toContain(bundle);
    expect(module.trustedSandboxDocument(bundle)).toContain("connect-src 'none'");
    expect(createPolicy).toHaveBeenCalledOnce();
    expect(createPolicy.mock.calls[0]?.[0]).toBe('verbis-plugin');
    expect(() => rule?.('<script>unapproved</script>')).toThrow('VERBIS_PLUGIN_DOCUMENT');
    vi.unstubAllGlobals();
    expect(trustedSandboxDocument(bundle)).toContain('<!doctype html>');
  });
});
