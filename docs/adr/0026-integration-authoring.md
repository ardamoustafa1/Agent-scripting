# ADR-0026: Integration authoring and approved production profiles

Date: 2026-10-02. Status: accepted. Integration definition schema 1.1.0.

Designer adds a lazy integration library and editor backed by the existing BFF integration engine.
Public data contracts now live in shared-types; frontend code never imports backend modules.
Definitions without schemaVersion normalize to 1.1.0 through shared validation; old definitions
remain readable. The model adds named success/empty/error/delay mock scenarios and a server-owned
pending production promotion. Existing endpoint paths remain v1.

PUT definitions now requires If-Match. The API checks the snapshot and uses version in the
atomic update predicate. This is a breaking write precondition; clients must first GET the
individual definition and send its version. Ordinary saves cannot modify the production profile,
including initial creation. A save cancels a pending approval. Profile promotion requests snapshot
the selected dev/test profile inside the definition, increment version and audit in the same
request transaction. Approval requires approve:Integration, read access, If-Match and a different
actor from the requester. Approval applies the stored snapshot and emits integration.profile.promoted.
Promotion request/approval increments the data-source version; consuming script pins must be
updated through their existing lifecycle before runtime execution can use the new version.
Profiles override base URL and auth; shared request/mapping/policy edits remain definition-wide,
as in the existing engine. This approval gates profile promotion, not a full release workflow.
Tenant administrators can grant approve:Integration to a separate reviewer; default script
approver roles do not acquire integration approval permission automatically.

cURL import is bounded token parsing with no process execution. Unsupported flags, shell
expansion, file reads and common embedded credential headers/query parameters reject the import.
OpenAPI JSON/YAML parses bounded local files, lists operations and resolves local schema refs;
remote refs and recursive/unbounded schemas fail closed. Authors explicitly select authentication
and a secret reference. WSDL operation parsing and GraphQL introspection use existing server APIs
after an initial save; introspection only runs against saved dev/test configuration. No browser
request goes directly to an upstream endpoint.

Mapping drag/drop generates bounded field projections; the keyboard equivalent selects a source
and target. Arbitrary advanced JSONata still runs in the bounded server mapping engine. Unsaved
mock preview is audited, redacted and never resolves secrets, DNS or transport. Live console uses
the last saved definition, execute permission and dev/test only. Preview traces stay in memory
and are capped at ten entries; no localStorage/history database stores them. Mock delay is bounded
at ten seconds. PII paths/conservative masking and cache restrictions remain server-enforced.

List health uses process-local engine samples; no cluster-wide or historical accuracy is implied.
Script consumers load on expansion and scan the latest 1000 version rows, returning a truncation
flag and filtering readable scripts. This bounded lookup should be replaced by an indexed
reference table for large deployments. Metadata-only secret reads remain audited. Secret entry
is write-only and immediately cleared from component state after submission or dialog dismissal.

Tests are authored but explicitly not executed at the user's request. Browser appearance,
keyboard interaction and zero axe violations remain acceptance checks.
