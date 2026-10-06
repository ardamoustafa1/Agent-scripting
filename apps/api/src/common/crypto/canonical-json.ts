import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` members dropped, dates as ISO,
 * bigints as decimal strings. Used for checksums, audit hashes and idempotency fingerprints.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : normalize(item)));
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined && typeof item !== 'function') out[key] = normalize(item);
  }
  return out;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}
