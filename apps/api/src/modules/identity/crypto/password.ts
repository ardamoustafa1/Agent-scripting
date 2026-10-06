import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the OWASP 2024 baseline (m = 19 MiB, t = 2, p = 1). The PHC string carries the
 * parameters, so they can be raised later without invalidating stored hashes.
 */
const OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 16;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}

/** A hash of a random value, verified when the account is unknown, to equalize timing. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('verbis-dummy-password-for-timing-equalization');
  return dummyHash;
}

/** Break-glass passwords: long passphrases; no composition rules (NIST SP 800-63B). */
export function passwordProblems(password: string, context: readonly string[]): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('tooShort');
  if (password.length > PASSWORD_MAX_LENGTH) problems.push('tooLong');
  if (new Set(password).size < 6) problems.push('tooRepetitive');
  const lower = password.toLowerCase();
  if (context.some((item) => item.length >= 4 && lower.includes(item.toLowerCase())))
    problems.push('containsContext');
  return problems;
}
