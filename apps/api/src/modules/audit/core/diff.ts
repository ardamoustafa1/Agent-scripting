import { REDACTED } from '../../../common/crypto/redact.js';

/**
 * PII-masked change records for audit events. Keys classified `@pii`/`@secret`/`@pci` (and the
 * DOMAIN sensitive list) never leave as values: the change stays visible, the value does not.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'email',
  'displayName',
  'phone',
  'msisdn',
  'notes',
  'participants',
  'attributes',
  'ciphertext',
  'password',
  'secret',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'pan',
  'cvv',
  'iban',
  'nationalId',
  'tckn',
  'ctiIdentities',
  'variables',
  'customer',
  'ip',
]);

const MAX_DEPTH = 20;
const DEFAULT_IGNORED = ['updatedAt', 'updatedBy', 'version'] as const;

export interface MaskOptions {
  /** Additional sensitive keys (e.g. variable names classified `@pii` in a script). */
  readonly extraSensitive?: ReadonlySet<string>;
}

function isSensitive(key: string, options: MaskOptions): boolean {
  return SENSITIVE_KEYS.has(key) || options.extraSensitive?.has(key) === true;
}

/** Deep copy with sensitive values masked; dates → ISO, bigint → string, functions dropped. */
export function maskPii(value: unknown, options: MaskOptions = {}, depth = 0): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object')
    return typeof value === 'function' ? undefined : value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => maskPii(item, options, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === 'function') continue;
    out[key] = isSensitive(key, options) ? REDACTED : maskPii(item, options, depth + 1);
  }
  return out;
}

export interface SnapshotDiff {
  readonly mode: 'snapshot';
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

export interface PatchOperation {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: string;
  readonly value?: unknown;
}

export interface PatchDiff {
  readonly mode: 'patch';
  readonly ops: readonly PatchOperation[];
}

export type AuditDiff = SnapshotDiff | PatchDiff;

function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value ?? null, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as unknown;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Changed top-level keys only, masked (create/delete keep the full masked snapshot). */
export function snapshotDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  options: MaskOptions & { ignore?: readonly string[] } = {},
): SnapshotDiff {
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORED);
  if (before === null || after === null) {
    return {
      mode: 'snapshot',
      before: before === null ? null : (maskPii(before, options) as Record<string, unknown>),
      after: after === null ? null : (maskPii(after, options) as Record<string, unknown>),
    };
  }
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignore.has(key) || equal(before[key], after[key])) continue;
    if (key in before) b[key] = before[key];
    if (key in after) a[key] = after[key];
  }
  return {
    mode: 'snapshot',
    before: maskPii(b, options) as Record<string, unknown>,
    after: maskPii(a, options) as Record<string, unknown>,
  };
}

/** RFC 6901 token escaping. */
function token(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * RFC 6902 patch from `before` to `after` (objects recurse, arrays are replaced whole). Values of
 * sensitive keys — at any depth — are replaced by the mask; the operation and path remain.
 */
export function patchDiff(
  before: unknown,
  after: unknown,
  options: MaskOptions & { ignore?: readonly string[] } = {},
): PatchDiff {
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORED);
  const ops: PatchOperation[] = [];
  const walk = (b: unknown, a: unknown, path: string, masked: boolean, depth: number): void => {
    const value = (v: unknown): unknown => (masked ? REDACTED : maskPii(v, options));
    const isObj = (v: unknown): v is Record<string, unknown> =>
      v !== null && typeof v === 'object' && !Array.isArray(v);
    if (depth < MAX_DEPTH && isObj(b) && isObj(a)) {
      for (const key of Object.keys(b).sort()) {
        if (depth === 0 && ignore.has(key)) continue;
        if (!(key in a)) ops.push({ op: 'remove', path: `${path}/${token(key)}` });
      }
      for (const key of Object.keys(a).sort()) {
        if (depth === 0 && ignore.has(key)) continue;
        const child = `${path}/${token(key)}`;
        const sensitive = masked || isSensitive(key, options);
        if (!(key in b))
          ops.push({
            op: 'add',
            path: child,
            value: sensitive ? REDACTED : maskPii(a[key], options),
          });
        else if (!equal(b[key], a[key])) walk(b[key], a[key], child, sensitive, depth + 1);
      }
      return;
    }
    if (!equal(b, a)) ops.push({ op: 'replace', path: path === '' ? '' : path, value: value(a) });
  };
  walk(plain(before), plain(after), '', false, 0);
  return { mode: 'patch', ops };
}
