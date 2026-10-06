# ADR-0011: Core API foundation (tenancy, unit of work, outbox, HTTP conventions)

- **Status:** Accepted · 2026-10-01
- **Amends:** [ADR-0003](0003-postgres-prisma.md) (concrete RLS design), [ADR-0005](0005-nats-event-bus.md) (outbox relay, streams)
- **Related:** [ADR-0004](0004-bff-auth.md), [ADR-0010](0010-script-model-v1.md), [SECURITY](../SECURITY.md), [DOMAIN](../DOMAIN.md), [PROGRESS](../PROGRESS.md) steps 4–6

## Context
`apps/api` needs one foundation for all 13 modules (tenancy, identity, authz, audit, campaigns,
scripts, screens, assignments, integrations, runtime, connectors, analytics, admin). The concerns are:

- tenant isolation that holds even when application code has a bug;
- atomic state + audit + event writes;
- standard pagination, idempotency, errors and OpenAPI;
- observability from the first request.

## Decision

### Tenancy: two layers
1. **Database (RLS).**
   - The schema owner runs migrations. The API connects as `verbis_app`: not a superuser, owns no tables, `NOBYPASSRLS`, no hard DELETE on domain tables.
   - At startup `PrismaService` refuses to run with a privileged role.
   - Every tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and the policy `tenant_id = app_current_tenant()`, both for reads (USING) and for writes (WITH CHECK).
   - `app_current_tenant()` reads `current_setting('app.tenant_id')`. If the setting is missing, nothing matches; if it is malformed, the query errors. Either way it fails closed.
   - `tenants` and `outbox_events` are `ENABLE` only. Narrow `SECURITY DEFINER` functions need cross-tenant access to them: `tenant_origin_allowed`, `outbox_claim/mark_*`, `outbox_requeue`, `outbox_purge_published`. Each function pins `search_path`, PUBLIC cannot execute it, and RLS still applies to `verbis_app` because it is not the owner.
2. **Application.**
   - The tenant comes only from the verified principal.
   - `AccessGuard` checks that the tenant is active and resolves the caller's permissions.
   - Every repository filters by `tenantId` explicitly.
   - A client-supplied tenant id is never read.

### Unit of work per request
- `TenantTransactionInterceptor` opens one interactive transaction per authenticated request and runs `SET LOCAL app.tenant_id` first.
- The handler, its audit event, its outbox events and its idempotency record all commit or roll back together.
- Public routes (health, docs) have no transaction.

### Identity at the API edge
- Callers present short-lived internal JWTs minted by the BFF (ADR-0004): EdDSA or ES256, a JWKS from env, fixed `iss`/`aud`, at most 5 minutes, and `tnt`/`typ`/`sub`/`jti` claims. Users get permissions from their roles in the DB; service principals get them from `scp`.
- `pnpm install` generates a local dev key pair, and `dev:token` mints tokens. Neither works in production.
- Authorization is deny-by-default. A route must declare `@RequirePermissions(...)` or `@AnyAuthenticated()`, and a spec fails when one does not.
- Permissions use the `action:Subject` vocabulary. CASL with ABAC conditions replaces the evaluation in step 10.

### Audit
- `AuditService.record(tx, …)` appends a per-tenant hash-chained event (`seq`, `prevHash`, `hash = SHA-256(prevHash ‖ canonicalJSON(event))`). It runs under `pg_advisory_xact_lock`, which keeps `seq` gap-free.
- Diffs are redacted.
- It also writes an outbox event, `verbis.audit.event.recorded.v1`.
- Reads of PII, secret metadata and the audit trail are audited as well.
- `audit_events` and `session_events` are append-only. There is no UPDATE/DELETE grant, and a trigger blocks UPDATE/DELETE/TRUNCATE even for the owner.

### Domain events: transactional outbox → NATS JetStream
- **Writing.** `OutboxWriter.record(tx, …)` writes to `outbox_events` in the caller's transaction and carries `correlationId` and W3C `traceparent`.
- **Relaying.** `OutboxRelay`:
  - leases due rows with `FOR UPDATE SKIP LOCKED` (so several replicas are safe);
  - publishes the envelope with `Nats-Msg-Id = event id`, which JetStream dedupes within a 2-minute window;
  - on failure, retries with exponential backoff and full jitter;
  - after `OUTBOX_MAX_ATTEMPTS`, marks the row `dead`; admins can requeue it.
- **Delivery** is at-least-once.
- **Consumers.** `IdempotentProcessor` inserts `(consumer, event_id)` into `processed_events` in the same tenant transaction as the handler's effects, so each event is applied exactly once. Failures are nak'ed with backoff. Poison messages, and messages that reach max deliveries, go to `verbis.dlq.<consumer>`.
- **Streams:**
  - `DOMAIN` (module contexts)
  - `AUDIT` (`verbis.audit.>`)
  - `SESSION` (`verbis.runtime.>`)
  - `INTERACTION` (`verbis.interaction.>`)
  - `DLQ` (`verbis.dlq.>`)
- **Ordering.** It is per relay batch, not global. Consumers must not rely on cross-aggregate order.

### HTTP conventions
- **Errors.** Everything is RFC 7807, with the code catalogue in `@verbis/shared-types` (`PROBLEM_CATALOG`). Hook and parser errors reach `ProblemDetailsFilter` through Nest's Fastify error handler. Responses never echo query strings and never show 5xx details.
- **Validation.** `@ZBody/@ZQuery/@ZParam` validate with zod and also record OpenAPI metadata. Script documents are validated by `@verbis/script-schema` (migrate → zod → semantics), and failures return 422 with `errors[].code`.
- **Pagination.**
  - Query: `?limit=1..100&cursor=<opaque>&sort=<field>|-<field>&<filters>`, keyset-based with an `id` tie-breaker.
  - The cursor is bound to the sort; reusing it with a different sort returns 400.
  - Response: `{ data, page: { limit, nextCursor, sort } }`.
- **Optimistic locking.** Every row has `version`. Writes require `If-Match: "<version>"`; a missing header returns 428 and a mismatch returns 412. Responses carry `ETag`.
- **Soft delete.** `deleted_at` is set instead of deleting. Unique keys are partial indexes (`WHERE deleted_at IS NULL`, Prisma `partialIndexes`).
- **Idempotency-Key** (authenticated POSTs).
  - Keys are scoped to tenant + principal and stored for 24 h.
  - The same key with the same request replays the stored response (`Idempotent-Replayed: true`).
  - The same key with a different request returns 422.
  - A concurrent duplicate waits on the unique index, then replays.
  - Because the record is part of the request transaction, a failed request leaves the key reusable.
- **Security.**
  - helmet sets `default-src 'none'`, HSTS and `no-referrer`.
  - CORS uses an exact-origin allow-list (env + `tenant.settings.allowedOrigins`, lookups cached for 60 s) with credentials and no wildcards.
  - The rate limit lives in Redis and is keyed by tenant + principal, or by IP when anonymous. It fails open when Redis is down, and readiness reports the outage.
- **OpenAPI 3.1** is generated from controller metadata and zod with `z.toJSONSchema` (draft 2020-12, native to 3.1); we do not use `@nestjs/swagger`, which targets 3.0 with class DTOs.
  - The spec is committed at `apps/api/openapi.json`, and a spec fails on drift.
  - `/api/docs` is `public` only in development, `admin` (`read:ApiDocs`) elsewhere, or `off`.
- **Health.**
  - `/health/live`: the process only.
  - `/health/ready` and `/health`: PostgreSQL, Redis and NATS, each with a 2 s timeout; 503 when any is down.

### Data model conventions
- Tenant-owned tables carry `id` (UUIDv7), `tenant_id`, `created_at/by`, `updated_at/by`, `deleted_at` and `version`.
- Documented exceptions:
  - `tenants` has no `tenant_id`; it is the root.
  - `audit_events` and `session_events` are append-only, so they have no update/delete/version columns.
  - Infrastructure tables (`outbox_events`, `processed_events`, `idempotency_keys`, `analytics_event_counts`) carry only what their mechanics need.
- `screens`, `components`, `flows` and `variables` are read models projected from `ScriptVersion.document` in the same transaction.
- **Script documents.**
  - Documents are stored as JSONB with lz4 TOAST compression.
  - Above `SCRIPT_DOCUMENT_COMPRESSION_THRESHOLD_BYTES` (default 256 KiB), the canonical JSON is stored gzip-compressed in `document_compressed`. A CHECK constraint enforces exactly one representation.
  - `checksum` is the SHA-256 of the canonical JSON without designer `position` data.

### Observability
- `main.ts` loads `telemetry.ts` first. It registers the ESM hooks and starts the NodeSDK for HTTP, Fastify, pg, ioredis and Prisma when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Then the app is imported.
- The outbox carries `traceparent`, so relay `publish` spans and consumer `process` spans continue the request's trace.
- pino logs are JSON. They:
  - redact secrets and PII by key;
  - omit query strings and bodies;
  - include `correlationId`, `tenantId` and `traceId` in every line.
- Inbound `x-correlation-id` is accepted only if it matches `[A-Za-z0-9._:-]{1,128}`; every response gets `x-correlation-id` and `x-request-id`.

## Consequences
- (+) A missing tenant filter cannot leak data, and the catalogue test fails when a new table lacks RLS. State, audit and events cannot diverge. One pattern serves every module.
- (+) Integration tests run against real PostgreSQL 16, Redis 7 and NATS (Testcontainers), so CI needs Docker.
- (−) One transaction per request holds a connection for the handler's duration. Handlers that call slow external systems (integration engine, step 16) must do that work outside the request transaction (e.g. through the outbox or jobs).
- (−) Permissions are loaded per request (a short extra transaction in `AccessGuard`). Cache them in Redis if this shows up in k6 (step 35).
- (−) The SECURITY DEFINER functions are privileged code. Keep them minimal and covered by the RLS suite.
- (−) Expired idempotency keys are purged lazily (per key). A scheduled purge job is still needed (BullMQ, follow-up).

## Alternatives
- **App-level tenant filtering only:** a single forgotten `where` leaks data. Rejected.
- **Prisma client extension that injects `tenantId`:** convenient, but it hides the filter and still needs RLS underneath. Kept explicit instead.
- **Publishing directly to NATS in the request:** dual-write inconsistency. Rejected in favour of the outbox.
- **`@nestjs/swagger`:** OpenAPI 3.0 with class-based DTOs, which would duplicate the zod schemas. Rejected.
- **`BYPASSRLS` worker role for the relay:** broader than needed. Rejected in favour of narrow SECURITY DEFINER functions.
