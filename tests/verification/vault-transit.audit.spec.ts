import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  EnvKeyAdapter,
  EnvelopeVault,
} from '../../apps/api/src/modules/integrations/engine/vault.js';
import { environmentVault } from '../../apps/api/src/modules/integrations/integration-engine.service.js';
import { testEnv } from '../../apps/api/test/support/env.js';

let container: StartedTestContainer | undefined;
let directory: string;
let address: string;
const rootToken = randomUUID();
const legacyKey = Buffer.alloc(32, 5).toString('base64');
async function admin(path: string, body?: unknown) {
  const response = await fetch(`${address}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Vault-Token': rootToken, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Synthetic Vault setup failed: ${path} ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
async function token() {
  const value = (await admin('auth/token/create', {
    policies: ['verbis-app'],
    no_default_policy: true,
  })) as { auth: { client_token: string } };
  return value.auth.client_token;
}
async function configured(overrides: Record<string, string> = {}) {
  const file = join(directory, randomUUID());
  const auth = await token();
  await writeFile(file, auth, { mode: 0o600 });
  const env = testEnv('{"keys":[]}', {
    INTEGRATION_KEY_PROVIDER: 'vault-transit',
    INTEGRATION_VAULT_ADDRESS: address,
    INTEGRATION_VAULT_TOKEN_FILE: file,
    INTEGRATION_VAULT_KEY: 'verbis-test',
    INTEGRATION_VAULT_TIMEOUT_MS: '1000',
    ...overrides,
  });
  return { vault: environmentVault(env), file, auth };
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'verbis-real-transit-'));
  container = await new GenericContainer('hashicorp/vault:2.0.4')
    .withEnvironment({ VAULT_DEV_ROOT_TOKEN_ID: rootToken })
    .withCommand(['server', '-dev', '-dev-listen-address=0.0.0.0:8200'])
    .withExposedPorts(8200)
    .withWaitStrategy(Wait.forHttp('/v1/sys/health', 8200))
    .start();
  address = `http://${container.getHost()}:${container.getMappedPort(8200)}`;
  await admin('sys/mounts/transit', { type: 'transit' });
  await admin('transit/keys/verbis-test', { type: 'aes256-gcm96', derived: true });
  await admin('transit/keys/non-derived', { type: 'aes256-gcm96' });
  await admin('transit/keys/exportable', { type: 'aes256-gcm96', derived: true, exportable: true });
  await admin('sys/policies/acl/verbis-app', {
    policy: `
path "transit/keys/*" { capabilities = ["read"] }
path "transit/encrypt/*" { capabilities = ["update"] }
path "transit/decrypt/*" { capabilities = ["update"] }
`,
  });
}, 120000);
afterAll(async () => {
  await container?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('encrypts and opens through the real remote key without a local master', async () => {
  const { vault } = await configured();
  const first = await vault.encrypt('tenant-a', 's1', 1, 'synthetic-secret');
  const second = await vault.encrypt('tenant-a', 's1', 1, 'synthetic-secret');
  expect(first.equals(second)).toBe(false);
  expect(first.toString()).toContain('vault:v1:');
  expect(first.toString()).not.toContain('synthetic-secret');
  await expect(vault.decrypt('tenant-a', 's1', 1, first)).resolves.toBe('synthetic-secret');
});
it.each([
  ['tenant-b', 's1', 1],
  ['tenant-a', 's2', 1],
  ['tenant-a', 's1', 2],
] as const)('rejects substituted tenant/record/version %s/%s/%s', async (tenant, id, version) => {
  const { vault } = await configured();
  const envelope = await vault.encrypt('tenant-a', 's1', 1, 'synthetic');
  await expect(vault.decrypt(tenant, id, version, envelope)).rejects.toThrow();
});
it('rotates keys, reads historical ciphertext and refuses deliberately retired versions', async () => {
  const { vault } = await configured();
  const old = await vault.encrypt('tenant-a', 's1', 1, 'synthetic-old');
  await admin('transit/keys/verbis-test/rotate', {});
  const next = await vault.encrypt('tenant-a', 's1', 1, 'synthetic-next');
  expect(next.toString()).toContain('vault:v2:');
  await expect(vault.decrypt('tenant-a', 's1', 1, old)).resolves.toBe('synthetic-old');
  await expect(vault.decrypt('tenant-a', 's1', 1, next)).resolves.toBe('synthetic-next');
  await admin('transit/keys/verbis-test/config', { min_decryption_version: 2 });
  try {
    await expect(vault.decrypt('tenant-a', 's1', 1, old)).rejects.toMatchObject({
      code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    });
  } finally {
    await admin('transit/keys/verbis-test/config', { min_decryption_version: 1 });
  }
});
it('fails closed on a revoked token even if a local master exists, then reads a renewed token sink', async () => {
  const { vault, file, auth } = await configured({ INTEGRATION_MASTER_KEY: legacyKey });
  const record = await vault.encrypt('tenant-a', 's1', 1, 'synthetic');
  await admin('auth/token/revoke', { token: auth });
  await expect(vault.decrypt('tenant-a', 's1', 1, record)).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    message: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  await expect(vault.encrypt('tenant-a', 's1', 1, 'synthetic')).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  await writeFile(file, await token());
  await expect(vault.decrypt('tenant-a', 's1', 1, record)).resolves.toBe('synthetic');
});
it.each(['non-derived', 'exportable'])(
  'refuses a key that violates tenant isolation or non-exportability: %s',
  async (key) => {
    const { vault } = await configured({ INTEGRATION_VAULT_KEY: key });
    await expect(vault.encrypt('tenant-a', 's1', 1, 'synthetic')).rejects.toMatchObject({
      code: 'VERBIS_INTEGRATION_UNAVAILABLE',
    });
  },
);
it('requires explicit legacy read migration and always writes new remote ciphertext', async () => {
  const oldVault = new EnvelopeVault(new EnvKeyAdapter(Buffer.from(legacyKey, 'base64')));
  const old = await oldVault.encrypt('tenant-a', 's1', 1, 'synthetic-old');
  const locked = await configured({ INTEGRATION_MASTER_KEY: legacyKey });
  await expect(locked.vault.decrypt('tenant-a', 's1', 1, old)).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  const migration = await configured({
    INTEGRATION_MASTER_KEY: legacyKey,
    INTEGRATION_VAULT_ALLOW_LEGACY_DECRYPT: 'true',
  });
  const recovered = await migration.vault.decrypt('tenant-a', 's1', 1, old);
  expect(recovered).toBe('synthetic-old');
  const migrated = await migration.vault.encrypt('tenant-a', 's1', 1, recovered);
  expect(migrated.toString()).toContain('vault:v');
  await expect(locked.vault.decrypt('tenant-a', 's1', 1, migrated)).resolves.toBe('synthetic-old');
});
it('rejects an overly permissive token file and recovers after correcting permissions', async () => {
  const { vault, file } = await configured();
  await chmod(file, 0o644);
  await expect(vault.encrypt('tenant-a', 's1', 1, 'synthetic')).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  await chmod(file, 0o600);
  await expect(vault.encrypt('tenant-a', 's1', 1, 'synthetic')).resolves.toBeInstanceOf(Buffer);
});
it('refuses writes and reads during a real Vault outage without local fallback', async () => {
  const { vault } = await configured({ INTEGRATION_MASTER_KEY: legacyKey });
  const record = await vault.encrypt('tenant-a', 's1', 1, 'synthetic');
  await container!.stop();
  container = undefined;
  await expect(vault.encrypt('tenant-a', 's1', 1, 'synthetic')).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
  await expect(vault.decrypt('tenant-a', 's1', 1, record)).rejects.toMatchObject({
    code: 'VERBIS_INTEGRATION_UNAVAILABLE',
  });
});
