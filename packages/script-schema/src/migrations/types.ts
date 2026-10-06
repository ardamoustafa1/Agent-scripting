/** Untyped document as stored for an older schema version. Migrations must not assume more. */
export type RawDocument = Record<string, unknown>;

export interface Migration {
  readonly from: string;
  readonly to: string;
  readonly description: string;
  /** Pure: receives a private deep copy and returns the migrated document (may mutate the copy). */
  readonly up: (doc: RawDocument) => RawDocument;
}

export type MigrationErrorCode =
  | 'SCHEMA_VERSION_MISSING'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_REGISTRY_INVALID';

export class MigrationError extends Error {
  override readonly name = 'MigrationError';

  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly version?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
