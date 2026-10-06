import { z } from 'zod';

/** Current script document format version (docs/SCRIPT_MODEL.md §9). */
export const SCRIPT_SCHEMA_VERSION = '1.1.0';

export const SemverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    'Expected semantic version MAJOR.MINOR.PATCH',
  );

/** Runtime supports the current major and N-1 via migrators. */
export function isSupportedSchemaVersion(version: string): boolean {
  if (!SemverSchema.safeParse(version).success) return false;
  const [currentMajor] = SCRIPT_SCHEMA_VERSION.split('.').map(Number);
  const [major] = version.split('.').map(Number);
  if (currentMajor === undefined || major === undefined) return false;
  return major === currentMajor || major === currentMajor - 1;
}
