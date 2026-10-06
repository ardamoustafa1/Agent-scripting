import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { z } from 'zod';

export interface KeyAdapter {
  wrap(tenantId: string, key: Buffer): Promise<string>;
  unwrap(tenantId: string, wrapped: string): Promise<Buffer>;
}
function seal(key: Buffer, plain: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString(
    'base64',
  );
}
function open(key: Buffer, sealed: string, aad: string): Buffer {
  const data = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]);
}
export class EnvKeyAdapter implements KeyAdapter {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Master key must be 32 bytes');
  }
  wrap(tenant: string, key: Buffer) {
    return Promise.resolve(seal(this.key, key, tenant));
  }
  unwrap(tenant: string, wrapped: string) {
    return Promise.resolve(open(this.key, wrapped, tenant));
  }
}
/** SDK/network plumbing is injected; adapters never expose the master key. */
export class AwsKmsAdapter implements KeyAdapter {
  constructor(
    private readonly encrypt: (plain: Buffer, context: Record<string, string>) => Promise<string>,
    private readonly decrypt: (cipher: string, context: Record<string, string>) => Promise<Buffer>,
  ) {}
  wrap(tenantId: string, key: Buffer) {
    return this.encrypt(key, { tenantId });
  }
  unwrap(tenantId: string, wrapped: string) {
    return this.decrypt(wrapped, { tenantId });
  }
}
export class VaultTransitAdapter implements KeyAdapter {
  constructor(
    private readonly encrypt: (key: string, context: string) => Promise<string>,
    private readonly decrypt: (cipher: string, context: string) => Promise<string>,
  ) {}
  wrap(tenantId: string, key: Buffer) {
    return this.encrypt(key.toString('base64'), Buffer.from(tenantId).toString('base64'));
  }
  async unwrap(tenantId: string, wrapped: string) {
    return Buffer.from(
      await this.decrypt(wrapped, Buffer.from(tenantId).toString('base64')),
      'base64',
    );
  }
}
const EnvelopeSchema = z.strictObject({ v: z.literal(1), wrapped: z.string(), data: z.string() });
/** Each envelope contains a fresh tenant-bound DEK; AAD also binds secret id and version. */
export class EnvelopeVault {
  constructor(private readonly keys: KeyAdapter) {}
  async encrypt(tenant: string, id: string, version: number, value: string): Promise<Buffer> {
    const dek = randomBytes(32);
    const plain = Buffer.from(value);
    try {
      return Buffer.from(
        JSON.stringify({
          v: 1,
          wrapped: await this.keys.wrap(tenant, dek),
          data: seal(dek, plain, `${tenant}:${id}:${version}`),
        }),
      );
    } finally {
      dek.fill(0);
      plain.fill(0);
    }
  }
  async decrypt(
    tenant: string,
    id: string,
    version: number,
    envelope: Uint8Array,
  ): Promise<string> {
    const record = EnvelopeSchema.parse(JSON.parse(Buffer.from(envelope).toString('utf8')));
    const dek = await this.keys.unwrap(tenant, record.wrapped);
    let plain: Buffer | undefined;
    try {
      plain = open(dek, record.data, `${tenant}:${id}:${version}`);
      return plain.toString('utf8');
    } finally {
      dek.fill(0);
      plain?.fill(0);
    }
  }
}
