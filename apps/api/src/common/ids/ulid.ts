import { randomBytes } from 'node:crypto';

/** Crockford base32 (no I, L, O, U). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const MAX_TIME = 2 ** 48 - 1;

export type RandomSource = (bytes: number) => Uint8Array;

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME)
    throw new RangeError('ULID time out of range');
  let out = '';
  let rest = ms;
  for (let i = 0; i < TIME_LEN; i += 1) {
    out = (ALPHABET[rest % 32] ?? '0') + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** 80 random bits as 16 base32 digits (5 bits each). */
function randomDigits(random: RandomSource): number[] {
  const bytes = random(10);
  const digits: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      digits.push((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return digits;
}

/** Adds one to the random part; throws on overflow (2^80 ids in one millisecond). */
function increment(digits: readonly number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const digit = next[i] ?? 0;
    if (digit < 31) {
      next[i] = digit + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error('ULID random component overflow');
}

/**
 * Monotonic ULID factory (ulid spec): ids from one factory are strictly increasing even within a
 * millisecond or when the clock steps back. Clock and randomness are injectable (tests).
 */
export function createUlidFactory(
  now: () => number = Date.now,
  random: RandomSource = (n) => randomBytes(n),
): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return () => {
    const currentTime = now();
    encodeTime(currentTime);
    const time = Math.max(currentTime, lastTime);
    lastRandom = time === lastTime ? increment(lastRandom) : randomDigits(random);
    lastTime = time;
    return encodeTime(time) + lastRandom.map((d) => ALPHABET[d] ?? '0').join('');
  };
}

/** Milliseconds since epoch encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!ULID_PATTERN.test(id)) throw new Error('Not a ULID');
  let ms = 0;
  for (const char of id.slice(0, TIME_LEN)) ms = ms * 32 + ALPHABET.indexOf(char);
  return ms;
}

export const ulid = createUlidFactory();
