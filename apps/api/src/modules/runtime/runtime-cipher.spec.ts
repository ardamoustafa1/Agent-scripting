import { createCipheriv, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Keyring } from '../identity/crypto/keyring.js';

import { RuntimeCipher } from './runtime-cipher.js';

describe('tenant envelope encryption', () => {
  it('uses independent DEKs and rejects cross-tenant/record substitutions', () => {
    const root = new Keyring(`test:${Buffer.alloc(32, 3).toString('base64')}`),
      cipher = new RuntimeCipher(root);
    const first = cipher.seal('synthetic', 'runtime:state:tenant-a:session-a');
    const second = cipher.seal('synthetic', 'runtime:state:tenant-a:session-a');
    expect(first).not.toBe(second);
    expect(cipher.openString(first, 'runtime:state:tenant-a:session-a')).toBe('synthetic');
    expect(() => cipher.openString(first, 'runtime:state:tenant-b:session-a')).toThrow();
    expect(() => cipher.openString(first, 'runtime:state:tenant-a:session-b')).toThrow();
    expect(() => cipher.openString(first, 'runtime:outcome:tenant-a:session-a')).toThrow();
    const tampered = JSON.parse(first) as Record<string, unknown>;
    tampered['body'] = 'AAAA';
    expect(() =>
      cipher.openString(JSON.stringify(tampered), 'runtime:state:tenant-a:session-a'),
    ).toThrow();
  });
  it('opens old DEK wraps after root-key rotation', () => {
    const oldKey = Buffer.alloc(32, 4).toString('base64'),
      nextKey = Buffer.alloc(32, 5).toString('base64');
    const sealed = new RuntimeCipher(new Keyring(`old:${oldKey}`)).seal(
      'synthetic',
      'runtime:state:tenant:session',
    );
    expect(
      new RuntimeCipher(new Keyring(`next:${nextKey},old:${oldKey}`)).openString(
        sealed,
        'runtime:state:tenant:session',
      ),
    ).toBe('synthetic');
  });
});

it('opens legacy v1 envelopes and writes tenant-derived v2 envelopes', () => {
  const root = new Keyring(`old:${Buffer.alloc(32, 6).toString('base64')}`),
    cipher = new RuntimeCipher(root);
  const dek = randomBytes(32),
    iv = randomBytes(12),
    aad = 'runtime:state:tenant:session';
  const legacy = createCipheriv('aes-256-gcm', dek, iv);
  legacy.setAAD(Buffer.from(aad));
  const body = Buffer.concat([legacy.update('legacy pii'), legacy.final()]);
  const record = JSON.stringify({
    v: 1,
    wrapped: root.seal(dek, 'runtime:dek:tenant'),
    iv: iv.toString('base64url'),
    body: body.toString('base64url'),
    tag: legacy.getAuthTag().toString('base64url'),
  });
  expect(cipher.openString(record, aad)).toBe('legacy pii');
  const next = cipher.seal(cipher.openString(record, aad), aad);
  const nextEnvelope = JSON.parse(next) as { wrapped: string };
  expect(JSON.parse(next)).toHaveProperty('v', 2);
  expect(root.derive('runtime:tenant-kek:tenant').activeKid).toBe('old');
  expect(() =>
    root.derive('runtime:tenant-kek:other').open(nextEnvelope.wrapped, 'runtime:dek:tenant'),
  ).toThrow();
  dek.fill(0);
});
it.each(['privacy', 'privacyReason'])(
  'binds %s envelopes to tenant, request and purpose',
  (scope) => {
    const cipher = new RuntimeCipher(
      new Keyring(`synthetic:${Buffer.alloc(32, 9).toString('base64')}`),
    );
    const aad = `runtime:${scope}:tenant-a:request-a`;
    const sealed = cipher.seal('synthetic-private-value', aad);
    expect(cipher.openString(sealed, aad)).toBe('synthetic-private-value');
    expect(() => cipher.openString(sealed, `runtime:${scope}:tenant-b:request-a`)).toThrow();
    expect(() => cipher.openString(sealed, `runtime:${scope}:tenant-a:request-b`)).toThrow();
    expect(() =>
      cipher.openString(
        sealed,
        `runtime:${scope === 'privacy' ? 'privacyReason' : 'privacy'}:tenant-a:request-a`,
      ),
    ).toThrow();
  },
);
