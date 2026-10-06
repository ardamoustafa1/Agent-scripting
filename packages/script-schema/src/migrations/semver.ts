import { SemverSchema } from '../version.js';

/** Compares MAJOR.MINOR.PATCH versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareSemver(a: string, b: string): number {
  const parse = (version: string): number[] => {
    if (!SemverSchema.safeParse(version).success)
      throw new TypeError(`Invalid semantic version: ${version}`);
    return version.split('.').map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
