import { migrate, type MigrateOptions } from '../migrations/migrate.js';
import { MigrationError } from '../migrations/types.js';
import { toPointer } from '../pointer.js';
import { ScriptDocumentSchema, type ScriptDocument } from '../schema/document.js';
import { SCRIPT_SCHEMA_VERSION } from '../version.js';

import { createIssue, hasErrors, type ValidationIssue } from './issues.js';
import { validateSemantics, type SemanticOptions } from './semantic.js';

import type { z } from 'zod';

export type ValidationResult =
  | {
      readonly ok: true;
      readonly document: ScriptDocument;
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly document?: ScriptDocument;
      readonly issues: readonly ValidationIssue[];
    };

/** Maps zod issues to validation issues. zod's English text is never surfaced; only its code. */
export function fromZodIssues(issues: readonly z.core.$ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) =>
    createIssue(
      'error',
      'SCHEMA_INVALID',
      toPointer(
        issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
      ),
      {
        reason: issue.code,
      },
    ),
  );
}

function versionIssue(input: unknown): ValidationIssue | undefined {
  const version =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)['schemaVersion']
      : undefined;
  if (version === undefined)
    return createIssue('error', 'SCHEMA_VERSION_MISSING', '/schemaVersion');
  if (version !== SCRIPT_SCHEMA_VERSION) {
    return createIssue('error', 'SCHEMA_VERSION_UNSUPPORTED', '/schemaVersion', {
      version: typeof version === 'string' ? version : JSON.stringify(version),
      expected: SCRIPT_SCHEMA_VERSION,
    });
  }
  return undefined;
}

/** Structural (zod) validation of a current-version document. */
export function parseScriptDocument(input: unknown): ValidationResult {
  const version = versionIssue(input);
  if (version !== undefined) return { ok: false, issues: [version] };
  const parsed = ScriptDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: fromZodIssues(parsed.error.issues) };
  return { ok: true, document: parsed.data, issues: [] };
}

/** Structural + semantic validation. `ok` is false when any issue has severity `error`. */
export function validateScriptDocument(
  input: unknown,
  options: SemanticOptions = {},
): ValidationResult {
  const parsed = parseScriptDocument(input);
  if (!parsed.ok) return parsed;
  const issues = validateSemantics(parsed.document, options);
  return hasErrors(issues)
    ? { ok: false, document: parsed.document, issues }
    : { ok: true, document: parsed.document, issues };
}

/** Migrates a stored document of any supported version, then validates it. */
export function loadScriptDocument(
  input: unknown,
  options: SemanticOptions & MigrateOptions = {},
): ValidationResult & { readonly migrated?: readonly string[] } {
  let migrated;
  try {
    migrated = migrate(input, options);
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    const code = error.code === 'MIGRATION_REGISTRY_INVALID' ? 'MIGRATION_FAILED' : error.code;
    return {
      ok: false,
      issues: [
        createIssue(
          'error',
          code,
          '/schemaVersion',
          error.version === undefined ? undefined : { version: error.version },
        ),
      ],
    };
  }
  return { ...validateScriptDocument(migrated.document, options), migrated: migrated.applied };
}
