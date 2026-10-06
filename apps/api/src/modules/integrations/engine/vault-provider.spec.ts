import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { testEnv } from '../../../../test/support/env.js';
import { environmentVault } from '../integration-engine.service.js';

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
it('selects remote Transit without loading a local master key', async () => {
  directory = await mkdtemp(join(tmpdir(), 'verbis-transit-unit-'));
  const tokenFile = join(directory, 'token');
  await writeFile(tokenFile, 'synthetic-agent-token', { mode: 0o600 });
  vi.stubEnv('INTEGRATION_MASTER_KEY', '');
  const transport = vi.fn<typeof fetch>().mockImplementation((url, options) => {
    expect(options?.headers).toMatchObject({ 'X-Vault-Token': 'synthetic-agent-token' });
    if (
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes('/keys/')
    )
      return Promise.resolve(
        Response.json({
          data: {
            derived: true,
            type: 'aes256-gcm96',
            exportable: false,
            allow_plaintext_backup: false,
          },
        }),
      );
    return Promise.resolve(Response.json({ data: { ciphertext: 'vault:v1:c3ludGhldGlj' } }));
  });
  vi.stubGlobal('fetch', transport);
  const env = testEnv('{"keys":[]}', {
    INTEGRATION_KEY_PROVIDER: 'vault-transit',
    INTEGRATION_VAULT_ADDRESS: 'https://vault.example.test',
    INTEGRATION_VAULT_TOKEN_FILE: tokenFile,
  });
  const vault = environmentVault(env);
  const encrypted = await vault.encrypt('tenant-a', 'secret', 1, 'synthetic-secret');
  expect(encrypted.toString()).toContain('vault:v1:');
  expect(encrypted.toString()).not.toContain('synthetic-secret');
  expect(transport).toHaveBeenCalledTimes(2);
});

it('rejects malformed stream results before accepting key metadata', async () => {
  directory = await mkdtemp(join(tmpdir(), 'verbis-transit-boundary-'));
  const tokenFile = join(directory, 'token');
  await writeFile(tokenFile, 'synthetic-agent-token', { mode: 0o600 });
  const reader = {
    read: vi
      .fn()
      .mockResolvedValueOnce({
        value: new TextEncoder().encode(
          JSON.stringify({
            data: {
              derived: true,
              type: 'aes256-gcm96',
              exportable: false,
              allow_plaintext_backup: false,
            },
          }),
        ),
        // Deliberately absent done: a malformed transport must fail closed.
      })
      .mockResolvedValue({ done: true }),
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn(),
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => reader } } as unknown as Response)
      .mockResolvedValue(Response.json({ data: { ciphertext: 'vault:v1:c3ludGhldGlj' } })),
  );
  const vault = environmentVault(
    testEnv('{"keys":[]}', {
      INTEGRATION_KEY_PROVIDER: 'vault-transit',
      INTEGRATION_VAULT_ADDRESS: 'https://vault.example.test',
      INTEGRATION_VAULT_TOKEN_FILE: tokenFile,
    }),
  );
  await expect(vault.encrypt('tenant-a', 'secret', 1, 'synthetic-secret')).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  expect(reader.cancel).toHaveBeenCalledOnce();
  expect(reader.releaseLock).toHaveBeenCalledOnce();
});
