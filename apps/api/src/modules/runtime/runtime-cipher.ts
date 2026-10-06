import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { IDENTITY_KEYRING } from '../identity/core/identity.tokens.js';
import { Keyring } from '../identity/crypto/keyring.js';

const Envelope = z.strictObject({
  v: z.union([z.literal(1), z.literal(2)]),
  wrapped: z.string(),
  iv: z.string(),
  body: z.string(),
  tag: z.string(),
});
/** Application-level envelope encryption: tenant-bound DEK wrapping, record-bound AES-GCM. */
@Injectable()
export class RuntimeCipher {
  constructor(@Inject(IDENTITY_KEYRING) private readonly root: Keyring) {}
  tenant(aad: string): string {
    const match = /^runtime:(state|outcome|interaction|privacy|privacyReason):([^:]+):/.exec(aad);
    if (match?.[2] === undefined) throw new Error('Invalid runtime encryption scope');
    return match[2];
  }
  seal(plain: string, aad: string): string {
    const tenant = this.tenant(aad),
      dek = randomBytes(32),
      iv = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return JSON.stringify({
        v: 2,
        wrapped: this.root
          .derive(`runtime:tenant-kek:${tenant}`)
          .seal(dek, `runtime:dek:${tenant}`),
        iv: iv.toString('base64url'),
        body: body.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
      });
    } finally {
      dek.fill(0);
    }
  }
  openString(sealed: string, aad: string): string {
    const tenant = this.tenant(aad),
      envelope = Envelope.parse(JSON.parse(sealed));
    // v1 compatibility permits lazy re-encryption on the next authoritative write.
    const wrapping =
      envelope.v === 1 ? this.root : this.root.derive(`runtime:tenant-kek:${tenant}`);
    const dek = wrapping.open(envelope.wrapped, `runtime:dek:${tenant}`);
    if (
      dek.length !== 32 ||
      Buffer.from(envelope.iv, 'base64url').length !== 12 ||
      Buffer.from(envelope.tag, 'base64url').length !== 16
    ) {
      dek.fill(0);
      throw new Error('Invalid runtime envelope');
    }
    try {
      const cipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(envelope.iv, 'base64url'));
      cipher.setAAD(Buffer.from(aad));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return Buffer.concat([
        cipher.update(Buffer.from(envelope.body, 'base64url')),
        cipher.final(),
      ]).toString('utf8');
    } finally {
      dek.fill(0);
    }
  }
}
