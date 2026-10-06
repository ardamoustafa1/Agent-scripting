import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { testEnv } from '../../../../test/support/env.js';

import { VaultTransitClient } from './vault-transit-client.js';

const metadata = {
  data: { derived: true, type: 'aes256-gcm96', exportable: false, allow_plaintext_backup: false },
};
const cipher = { data: { ciphertext: 'vault:v1:c3ludGhldGlj' } };
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup(value = 'synthetic-token', mode = 0o600) {
  const dir = await mkdtemp(join(tmpdir(), 'verbis-vault-gates-'));
  directories.push(dir);
  const file = join(dir, 'token');
  await writeFile(file, value, { mode });
  const client = new VaultTransitClient(
    testEnv('{"keys":[]}', {
      INTEGRATION_KEY_PROVIDER: 'vault-transit',
      INTEGRATION_VAULT_ADDRESS: 'https://vault.example.io',
      INTEGRATION_VAULT_TOKEN_FILE: file,
      INTEGRATION_VAULT_NAMESPACE: 'tenant-ns',
      INTEGRATION_VAULT_TIMEOUT_MS: '1000',
    }),
  );
  return { adapter: client.adapter(), file };
}
it.each(['', 'invalid token', 'x'.repeat(16385)])(
  'rejects malformed/oversized agent token sinks before upstream I/O',
  async (token) => {
    const f = await setup(token);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).rejects.toMatchObject({
      code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);
it('rejects publicly readable and missing token sinks', async () => {
  const f = await setup();
  await chmod(f.file, 0o644);
  await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).rejects.toThrow();
  await rm(f.file);
  await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).rejects.toThrow();
});
it.each(['http-error', 'no-body', 'oversized', 'invalid-json'])(
  'fails closed on %s and retries key validation safely',
  async (failure) => {
    const f = await setup();
    const bad =
      failure === 'http-error'
        ? new Response('provider details', { status: 500 })
        : failure === 'no-body'
          ? new Response(null)
          : new Response(failure === 'oversized' ? 'x'.repeat(65537) : 'not-json');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json(cipher));
    vi.stubGlobal('fetch', fetch);
    await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).rejects.toMatchObject({
      code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    });
    await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).resolves.toBe(cipher.data.ciphertext);
  },
);
it('checks encryption/decryption envelopes, caches approved metadata, and never leaks provider payloads', async () => {
  const f = await setup();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json({ data: { ciphertext: 'untrusted-provider-body' } }))
    .mockResolvedValueOnce(Response.json(cipher))
    .mockResolvedValueOnce(
      Response.json({ data: { plaintext: Buffer.alloc(32, 7).toString('base64') } }),
    )
    .mockResolvedValueOnce(Response.json({ data: { plaintext: 'bad' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).resolves.toBe(cipher.data.ciphertext);
  await expect(f.adapter.unwrap('tenant', cipher.data.ciphertext)).resolves.toEqual(
    Buffer.alloc(32, 7),
  );
  await expect(f.adapter.unwrap('tenant', cipher.data.ciphertext)).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  const calls = fetch.mock.calls.length;
  await expect(f.adapter.unwrap('tenant', 'not-a-vault-envelope')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ 'X-Vault-Namespace': 'tenant-ns' });
});
it('aborts an unavailable Transit request at the deadline', async () => {
  const f = await setup();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('deadline'));
            },
            {
              once: true,
            },
          ),
        ),
    ),
  );
  await expect(f.adapter.wrap('tenant', Buffer.alloc(32))).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
});
