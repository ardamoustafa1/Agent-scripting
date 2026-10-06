# ADR-0031: Privacy-bound session analytics and report control plane

Date: 2026-10-03. Status: accepted for implementation; deployment/browser acceptance pending.

## Decision

Keep analytics inside the API module boundary (ADR-0009). Reuse transactional outbox and existing idempotent JetStream processors (ADR-0005), with dedicated SESSION and DOMAIN consumers. Persist strict, immutable metadata-only facts keyed by tenant/event/time in PostgreSQL; FORCE RLS applies to facts, schedule rows and erasure tombstones. Upgrade the facts table to a Timescale hypertable when the operator provisioned the extension. An optional fixed-statement HTTP ClickHouse adapter uses ReplacingMergeTree/FINAL for retry deduplication. PostgreSQL remains the transactional control plane and retained projection.

Use server-secret, tenant-bound HMAC pseudonyms for agents; never copy actor IDs, customer identities, variables, labels, notes, payload bodies or arbitrary error strings into facts. Pin script version/source/node IDs and launch A/B variant metadata. Apply CASL instance predicates and inverted grants before calculating aggregates and intersect per-recipient permissions before email delivery. Generic tenant event-count queries require an unscoped Report grant, since this aggregate cannot safely reconstruct campaign/team scope.

A shared UI dashboard in packages/ui is loaded lazily by both applications; central TR/EN catalogs, tokens, logical CSS and accessible fallback tables accompany Recharts bar/Sankey graphs. Exact-version heatmaps decorate the existing screen canvas. Supervisor uses bounded polling rather than introducing a new unauthenticated socket feed. The existing agent/runtime lease contract validates bounded timing and read metadata; no direct browser warehouse writes are permitted.

## Consequences

Postgres projection plus dedup ledger commits atomically. ClickHouse is an optional cross-store side effect with eventual retry recovery, not distributed exactly-once commit. SMTP cannot guarantee exactly-once external delivery; stable Message-ID and audit/DLQ diagnostics are provided, and repeats are documented. Disabled optional consumers are not started so retained messages are not acknowledged and lost. Retention locks tenant settings, honors legal hold, and purges both adapters. Customer erasure installs tombstones to prevent NATS replay from rebuilding projections.

Reports are bounded to 366 days/50k events; no silent sampling. Interactive metrics use same-period observed start cohorts; active dwell is censored. AB significance is a sparse-cell guarded two-sided pooled z-test with within-experiment Bonferroni correction, not a causal or sequential testing framework. OData supports service/metadata/paged read subset with explicit date filters; arbitrary SQL and OData query execution are not exposed. Large-scale preaggregations, historical backfill tooling, durable offline field telemetry and full OData query interoperability remain explicit follow-ups.

See [analytics setup and semantics](../analytics/README.md). Tests are written but were not run by user instruction; migrations were not applied.

Append-only fact/read-model and erasure-tombstone tables intentionally omit mutable `created_by/updated_by/deleted_at/version` columns: event IDs/time and tenant/session erasure keys are their provenance, and persisting raw actor identities would violate the analytics projection boundary. Schedule rows use normal control-plane lifecycle columns. This is a scoped schema convention exception, not a waiver for operational domain tables.
