# ADR 0046 — Immutable data source versions

Status: Accepted · 2026-10-06 · D-16

Published script versions pin a tenant data source as `(ref, version)`. Until now only the live `data_sources` row existed, so editing a source after publication (endpoint, auth, policy, secretRefs) silently changed the behavior of pinned, already-published scripts.

Decision: `data_source_versions` is an append-only table (tenant_id with FORCE RLS, UUIDv7 ids, unique `(data_source_id, version)`, SHA-256 `content_hash` over key/protocol/definition/secretRefs/policy). Credentials are `secretRefs` (secret metadata ids) only; no secret value is ever stored. A database trigger on `data_sources` writes a snapshot for every insert and every version-bumping update inside the mutation's transaction, so it commits or rolls back with the change and its audit event, and it covers every writer. Updates and deletes are rejected by trigger (also for the owner role); the runtime role has only SELECT/INSERT. Existing rows are backfilled with their current revision (earlier revisions were never stored).

Resolution: runtime execution (`prepareAuthorized`) and authoring simulation resolve the document's pinned version from `data_source_versions` and use that definition, policy and secretRefs. The live row is consulted only for tenant authorization and soft-delete state. A pinned version with no snapshot is served from the live row only if the live version is identical (legacy rows); otherwise the call is refused (execution: forbidden; simulation: version mismatch).

Consequences: editing a source creates version N+1 without altering pins to N. Data sources are soft-deleted only; hard deletion is blocked by the `ON DELETE RESTRICT` foreign key. Not a public API break (no OpenAPI change). Follow-up: renaming a source key after publication still breaks lookup by key.
