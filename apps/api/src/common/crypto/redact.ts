/** Field names whose values never reach audit diffs, events or logs (DOMAIN invariant 7). */
const SENSITIVE_KEYS = new Set([
  'email',
  'displayName',
  'notes',
  'participants',
  'attributes',
  'ciphertext',
  'password',
  'secret',
  'token',
  'ctiIdentities',
  'variables',
]);

export const REDACTED = '[REDACTED]';

/** Deep copy with sensitive keys masked. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

/** Shallow before/after diff of changed keys, redacted. */
export function auditDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  ignore: readonly string[] = ['updatedAt', 'updatedBy', 'version'],
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  if (before === null || after === null) {
    return {
      before: before === null ? null : (redact(before) as Record<string, unknown>),
      after: after === null ? null : (redact(after) as Record<string, unknown>),
    };
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return {
    before: redact(b) as Record<string, unknown>,
    after: redact(a) as Record<string, unknown>,
  };
}
