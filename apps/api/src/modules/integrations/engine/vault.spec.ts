import { describe, expect, it } from 'vitest';

import { AwsKmsAdapter, EnvKeyAdapter, EnvelopeVault, VaultTransitAdapter } from './vault.js';

describe('tenant-bound envelope vault', () => {
  const vault = new EnvelopeVault(new EnvKeyAdapter(Buffer.alloc(32, 7)));
  it('encrypts with independent random DEKs and decrypts with matching AAD', async () => {
    const first = await vault.encrypt('tenant-a', 'secret-a', 1, 'synthetic-value');
    const second = await vault.encrypt('tenant-a', 'secret-a', 1, 'synthetic-value');
    expect(first.equals(second)).toBe(false);
    expect(first.toString()).not.toContain('synthetic-value');
    await expect(vault.decrypt('tenant-a', 'secret-a', 1, first)).resolves.toBe('synthetic-value');
  });
  it.each([
    ['tenant-b', 'secret-a', 1],
    ['tenant-a', 'secret-b', 1],
    ['tenant-a', 'secret-a', 2],
  ] as const)('rejects AAD mismatch %s/%s/%s', async (tenant, id, version) => {
    await expect(
      vault.decrypt(
        tenant,
        id,
        version,
        await vault.encrypt('tenant-a', 'secret-a', 1, 'synthetic'),
      ),
    ).rejects.toThrow();
  });
  it('rejects altered ciphertext and incorrect master keys', async () => {
    const envelope = await vault.encrypt('tenant-a', 'secret-a', 1, 'synthetic');
    const record = JSON.parse(envelope.toString()) as { data: string };
    const bytes = Buffer.from(record.data, 'base64');
    bytes[12] = (bytes[12] ?? 0) ^ 1;
    record.data = bytes.toString('base64');
    await expect(
      vault.decrypt('tenant-a', 'secret-a', 1, Buffer.from(JSON.stringify(record))),
    ).rejects.toThrow();
    await expect(
      new EnvelopeVault(new EnvKeyAdapter(Buffer.alloc(32, 8))).decrypt(
        'tenant-a',
        'secret-a',
        1,
        envelope,
      ),
    ).rejects.toThrow();
  });
  it('passes tenant encryption context to AWS KMS and Vault Transit', async () => {
    const seen: unknown[] = [];
    const kms = new AwsKmsAdapter(
      (key, context) => {
        seen.push(context);
        return Promise.resolve(key.toString('base64'));
      },
      (wrapped, context) => {
        seen.push(context);
        return Promise.resolve(Buffer.from(wrapped, 'base64'));
      },
    );
    const transit = new VaultTransitAdapter(
      (key, context) => {
        seen.push(context);
        return Promise.resolve(key);
      },
      (key, context) => {
        seen.push(context);
        return Promise.resolve(key);
      },
    );
    for (const adapter of [kms, transit]) {
      const local = new EnvelopeVault(adapter);
      const record = await local.encrypt('tenant-a', 's', 1, 'synthetic');
      await expect(local.decrypt('tenant-a', 's', 1, record)).resolves.toBe('synthetic');
    }
    expect(seen).toEqual([
      { tenantId: 'tenant-a' },
      { tenantId: 'tenant-a' },
      Buffer.from('tenant-a').toString('base64'),
      Buffer.from('tenant-a').toString('base64'),
    ]);
  });
});
