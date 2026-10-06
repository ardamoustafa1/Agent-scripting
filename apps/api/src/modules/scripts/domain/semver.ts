/** Semantic Versioning 2.0.0 (no build metadata): parse, compare, bump. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

const PATTERN =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export function parseSemver(value: string): SemVer | undefined {
  const match = PATTERN.exec(value);
  if (match === null) return undefined;
  const [, major, minor, patch, pre] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease:
      pre === undefined ? [] : pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
  };
}

export function isSemver(value: string): boolean {
  return parseSemver(value) !== undefined;
}

function comparePre(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // release > prerelease
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** -1 / 0 / 1 by SemVer precedence. Throws on invalid input. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (x === undefined || y === undefined) throw new Error('invalid semver');
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  return comparePre(x.prerelease, y.prerelease);
}

export function maxSemver(values: readonly string[]): string | undefined {
  return values.reduce<string | undefined>(
    (max, v) => (max === undefined || compareSemver(v, max) > 0 ? v : max),
    undefined,
  );
}

export type BumpKind = 'major' | 'minor' | 'patch';

export function bumpSemver(value: string | undefined, kind: BumpKind): string {
  const v = value === undefined ? { major: 0, minor: 0, patch: 0 } : parseSemver(value);
  if (v === undefined) throw new Error('invalid semver');
  if (kind === 'major') return `${String(v.major + 1)}.0.0`;
  if (kind === 'minor') return `${String(v.major)}.${String(v.minor + 1)}.0`;
  return `${String(v.major)}.${String(v.minor)}.${String(v.patch + 1)}`;
}
