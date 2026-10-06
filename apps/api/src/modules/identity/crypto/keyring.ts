import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SealedDataError extends Error {
  override readonly name = 'SealedDataError';
}

/**
 * AES-256-GCM keyring for data the server keeps sealed at rest (session records, IdP secrets,
 * TOTP seeds). The first key seals; every key opens, so keys rotate without re-encryption
 * downtime. The additional authenticated data (AAD) binds a ciphertext to its slot, so a sealed
 * value copied to another record does not open.
 *
 * Sealed form: `v1.<kid>.<iv>.<ciphertext>.<tag>` (base64url parts).
 * Step 16 replaces the env-provided keys with KMS/Vault-wrapped data keys (SECURITY §5.7).
 */
export class Keyring {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly activeKid: string;

  constructor(spec: string) {
    const keys = new Map<string, Buffer>();
    for (const entry of spec.split(',').map((item) => item.trim())) {
      const separator = entry.indexOf(':');
      const kid = entry.slice(0, separator);
      const key = Buffer.from(entry.slice(separator + 1), 'base64');
      if (separator <= 0 || !/^[A-Za-z0-9_-]{1,32}$/.test(kid) || key.length !== 32) {
        throw new Error('IDENTITY_ENCRYPTION_KEYS entries must be kid:base64(32 bytes)');
      }
      if (keys.has(kid)) throw new Error(`IDENTITY_ENCRYPTION_KEYS has a duplicate kid: ${kid}`);
      keys.set(kid, key);
    }
    const first = [...keys.keys()][0];
    if (first === undefined) throw new Error('IDENTITY_ENCRYPTION_KEYS is empty');
    this.#keys = keys;
    this.activeKid = first;
  }

  /** Domain-separated key rings, retaining kid order for decrypting historical envelopes. */
  derive(domain: string): Keyring {
    if (!domain || domain.length > 512) throw new Error('Invalid key derivation domain');
    const spec = [...this.#keys]
      .map(([kid, key]) => {
        const derived = Buffer.from(hkdfSync('sha256', key, 'verbis-kek-v2', domain, 32));
        try {
          return `${kid}:${derived.toString('base64')}`;
        } finally {
          derived.fill(0);
        }
      })
      .join(',');
    return new Keyring(spec);
  }

  seal(plaintext: string | Buffer, aad: string): string {
    const key = this.#keys.get(this.activeKid);
    if (key === undefined) throw new Error('active key missing');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([
      cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext),
      cipher.final(),
    ]);
    return [
      VERSION,
      this.activeKid,
      iv.toString('base64url'),
      body.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  open(sealed: string, aad: string): Buffer {
    const parts = sealed.split('.');
    const [version, kid, iv, body, tag] = parts;
    if (
      parts.length !== 5 ||
      version !== VERSION ||
      kid === undefined ||
      iv === undefined ||
      body === undefined ||
      tag === undefined
    ) {
      throw new SealedDataError('malformed sealed value');
    }
    const key = this.#keys.get(kid);
    if (key === undefined) throw new SealedDataError('unknown key id');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
    } catch {
      throw new SealedDataError('sealed value failed authentication');
    }
  }

  openString(sealed: string, aad: string): string {
    return this.open(sealed, aad).toString('utf8');
  }

  /** True when the value was sealed with a key other than the active one (re-seal on write). */
  needsRotation(sealed: string): boolean {
    return sealed.split('.')[1] !== this.activeKid;
  }
}
