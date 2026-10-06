import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const crypto = webcrypto;
/** Verifies the encryption boundary; browser persistence has separate e2e coverage. */
describe('encrypted draft cryptography', () => {
  it('uses a non-extractable key and rejects another tenant/session AAD', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    expect(key.extractable).toBe(false);
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      aad = new TextEncoder().encode('tenant:user:bff:session');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      key,
      new TextEncoder().encode('synthetic draft'),
    );
    expect(new TextDecoder().decode(ciphertext)).not.toContain('synthetic draft');
    await expect(
      crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('different:session') },
        key,
        ciphertext,
      ),
    ).rejects.toThrow();
  });
});
