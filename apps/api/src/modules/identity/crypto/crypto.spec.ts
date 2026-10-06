import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Keyring, SealedDataError } from './keyring.js';
import { dummyPasswordHash, hashPassword, passwordProblems, verifyPassword } from './password.js';
import { randomToken, safeEqual, sha256Hex } from './random.js';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totp,
  totpUri,
  verifyTotp,
} from './totp.js';

const key = () => randomBytes(32).toString('base64');

describe('Keyring', () => {
  it('seals and opens with the AAD it was sealed for', () => {
    const ring = new Keyring(`k1:${key()}`);
    const sealed = ring.seal('secret value', 'slot-a');
    expect(sealed).toMatch(/^v1\.k1\./);
    expect(sealed).not.toContain('secret');
    expect(ring.openString(sealed, 'slot-a')).toBe('secret value');
    expect(() => ring.open(sealed, 'slot-b')).toThrow(SealedDataError);
  });

  it('detects tampering and malformed input', () => {
    const ring = new Keyring(`k1:${key()}`);
    const parts = ring.seal('x', 'a').split('.');
    parts[3] = Buffer.from('y').toString('base64url');
    expect(() => ring.open(parts.join('.'), 'a')).toThrow(SealedDataError);
    expect(() => ring.open('v2.k1.a.b.c', 'a')).toThrow(SealedDataError);
    expect(() => ring.open('nonsense', 'a')).toThrow(SealedDataError);
  });

  it('rotates: old keys still open, the first key seals', () => {
    const oldKey = key();
    const old = new Keyring(`k1:${oldKey}`);
    const sealed = old.seal('v', 'a');
    const rotated = new Keyring(`k2:${key()},k1:${oldKey}`);
    expect(rotated.openString(sealed, 'a')).toBe('v');
    expect(rotated.needsRotation(sealed)).toBe(true);
    expect(rotated.needsRotation(rotated.seal('v', 'a'))).toBe(false);
    expect(() => new Keyring(`k3:${key()}`).open(sealed, 'a')).toThrow(/unknown key/);
  });

  it('rejects bad specs', () => {
    expect(() => new Keyring('k1:short')).toThrow();
    expect(() => new Keyring(`:${key()}`)).toThrow();
    const k = key();
    expect(() => new Keyring(`a:${k},a:${k}`)).toThrow(/duplicate/);
  });
});

describe('random helpers', () => {
  it('produces 256-bit url-safe tokens and compares in constant time', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  // RFC 4226 appendix D: secret "12345678901234567890".
  const rfcSecret = Buffer.from('12345678901234567890');

  it('matches the RFC 4226 HOTP test vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314'];
    expected.forEach((code, counter) => {
      expect(hotp(rfcSecret, BigInt(counter))).toBe(code);
    });
  });

  it('matches the RFC 6238 SHA-1 vectors (truncated to 6 digits)', () => {
    const secret = base32Encode(rfcSecret);
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1_111_111_109_000)).toBe('081804');
    expect(totp(secret, 1_234_567_890_000)).toBe('005924');
    expect(totp(secret, 20_000_000_000_000)).toBe('353130');
  });

  it('round-trips base32', () => {
    const data = randomBytes(20);
    expect(base32Decode(base32Encode(data)).equals(data)).toBe(true);
    expect(() => base32Decode('1')).toThrow();
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts ±1 step, rejects other codes and replays', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const previous = totp(secret, now - 30_000);
    expect(verifyTotp(secret, totp(secret, now), now)).not.toBeNull();
    expect(verifyTotp(secret, previous, now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
    const step = verifyTotp(secret, totp(secret, now), now);
    expect(verifyTotp(secret, totp(secret, now), now, { lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, previous, now, { lastUsedStep: step })).toBeNull();
  });

  it('builds an otpauth URI', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'Verbis acme', 'root@acme.test');
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/Verbis%20acme:root%40acme\.test\?secret=JBSWY3DPEHPK3PXP/,
    );
    expect(uri).toContain('period=30');
  });
});

describe('argon2id passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const phc = await hashPassword('correct horse battery staple');
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(phc, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(phc, 'wrong horse battery staple')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await dummyPasswordHash()).toMatch(/^\$argon2id\$/);
  });

  it('checks length, repetition and context', () => {
    expect(passwordProblems('short', [])).toContain('tooShort');
    expect(passwordProblems('a'.repeat(300), [])).toEqual(
      expect.arrayContaining(['tooLong', 'tooRepetitive']),
    );
    expect(passwordProblems('acme-root-password-2026!', ['acme'])).toEqual(['containsContext']);
    expect(passwordProblems('quiet-river-lamp-stone-77', ['acme'])).toEqual([]);
  });
});
