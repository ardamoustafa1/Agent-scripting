import { cloneJson } from '../json.js';
import { SCRIPT_SCHEMA_VERSION, SemverSchema } from '../version.js';

import { compareSemver } from './semver.js';
import { MigrationError, type Migration, type RawDocument } from './types.js';
import { v0_9_0_to_v1_0_0 } from './v0-9-0-to-v1-0-0.js';
import { v1_0_0_to_v1_1_0 } from './v1-0-0-to-v1-1-0.js';

/** Registered migrations, oldest first. Add one per schemaVersion bump, with a test. */
export const MIGRATIONS: readonly Migration[] = Object.freeze([v0_9_0_to_v1_0_0, v1_0_0_to_v1_1_0]);

export interface MigrateOptions {
  readonly migrations?: readonly Migration[];
  readonly targetVersion?: string;
}

export interface MigrationResult {
  readonly document: RawDocument;
  readonly fromVersion: string;
  readonly toVersion: string;
  /** `"0.9.0→1.0.0"` per applied step, in order. */
  readonly applied: readonly string[];
}

/** Checks a registry: valid semver, strictly increasing steps, at most one step per source version. */
export function assertMigrationRegistry(migrations: readonly Migration[]): void {
  const sources = new Set<string>();
  for (const migration of migrations) {
    const label = `${migration.from}→${migration.to}`;
    if (
      !SemverSchema.safeParse(migration.from).success ||
      !SemverSchema.safeParse(migration.to).success
    ) {
      throw new MigrationError(
        'MIGRATION_REGISTRY_INVALID',
        `Invalid version in migration ${label}`,
      );
    }
    if (compareSemver(migration.to, migration.from) <= 0) {
      throw new MigrationError(
        'MIGRATION_REGISTRY_INVALID',
        `Migration ${label} must move forward`,
      );
    }
    if (sources.has(migration.from)) {
      throw new MigrationError(
        'MIGRATION_REGISTRY_INVALID',
        `Two migrations start at ${migration.from}`,
      );
    }
    sources.add(migration.from);
  }
}

/** Whether `version` is the target or can be migrated to it. */
export function canMigrate(version: string, options: MigrateOptions = {}): boolean {
  const target = options.targetVersion ?? SCRIPT_SCHEMA_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  let current = version;
  for (let steps = 0; steps <= migrations.length; steps += 1) {
    if (current === target) return true;
    const next = migrations.find((migration) => migration.from === current);
    if (next === undefined) return false;
    current = next.to;
  }
  return false;
}

/**
 * Runs the migration chain from the document's `schemaVersion` up to the target (default:
 * current). Never mutates the input. Throws `MigrationError` when no path exists.
 */
export function migrate(input: unknown, options: MigrateOptions = {}): MigrationResult {
  const target = options.targetVersion ?? SCRIPT_SCHEMA_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  assertMigrationRegistry(migrations);

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new MigrationError('SCHEMA_VERSION_MISSING', 'Document must be a JSON object');
  }
  const fromVersion = (input as RawDocument)['schemaVersion'];
  if (typeof fromVersion !== 'string' || !SemverSchema.safeParse(fromVersion).success) {
    throw new MigrationError('SCHEMA_VERSION_MISSING', 'Document has no valid schemaVersion');
  }
  if (compareSemver(fromVersion, target) > 0) {
    throw new MigrationError(
      'SCHEMA_VERSION_UNSUPPORTED',
      `Version ${fromVersion} is newer than ${target}`,
      fromVersion,
    );
  }

  let document = cloneJson(input) as RawDocument;
  let current = fromVersion;
  const applied: string[] = [];
  while (current !== target) {
    const step = migrations.find((migration) => migration.from === current);
    if (step === undefined || compareSemver(step.to, target) > 0) {
      throw new MigrationError(
        'SCHEMA_VERSION_UNSUPPORTED',
        `No migration path from ${current} to ${target}`,
        current,
      );
    }
    try {
      document = { ...step.up(document), schemaVersion: step.to };
    } catch (cause) {
      throw new MigrationError(
        'MIGRATION_FAILED',
        `Migration ${step.from}→${step.to} failed`,
        current,
        { cause },
      );
    }
    applied.push(`${step.from}→${step.to}`);
    current = step.to;
  }
  return { document, fromVersion, toVersion: target, applied };
}
