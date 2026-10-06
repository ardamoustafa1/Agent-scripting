/**
 * Makes a value safe for PostgreSQL text/JSONB and stable across a JSONB round trip, so the hash
 * computed before insert equals the hash recomputed from the stored row:
 * NUL characters (rejected by PostgreSQL) become U+FFFD, non-finite numbers become null, bigint
 * becomes a decimal string, dates become ISO strings, `undefined`/functions are dropped.
 */
const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);

export function sanitizeText(value: string): string {
  return value.replaceAll(NUL, REPLACEMENT);
}

export function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 32) return '[TRUNCATED]';
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return sanitizeText(value);
    case 'number':
      return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object': {
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map((item) => sanitizeJson(item, depth + 1) ?? null);
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const clean = sanitizeJson(item, depth + 1);
        if (clean !== undefined) out[sanitizeText(key)] = clean;
      }
      return out;
    }
    default:
      return undefined;
  }
}
