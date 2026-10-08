# Analytics

Analytics is a module of `apps/api`; there is no new public ingestion endpoint or new script launch route. Read `../adr/0031-session-analytics-and-reporting.md` for semantics and limitations.

## Setup

1. Provision PostgreSQL normally. For TimescaleDB, install the extension as the database owner before applying migration `20261003150000_analytics`. The migration converts the table when the extension is installed; ordinary PostgreSQL remains supported. The application never creates extensions.
2. Apply the checked-in migration with the repository deployment migration workflow. **This implementation turn did not run migrations.** Existing FORCE RLS and least-privilege `verbis_app` connections remain mandatory.
3. Set server-only `ANALYTICS_ENABLED=true`, `ANALYTICS_STORAGE=postgres`, `EVENT_CONSUMERS_ENABLED=true`, and `ANALYTICS_PSEUDONYM_KEY` to an independent secret containing a base64-encoded 32-byte random key. Never use a tenant ID or a public salt as the key. Do not expose this key to any frontend environment. Keep it stable; rotating it changes pseudonyms across periods.
4. Start the existing API/NATS outbox services. The durable consumers are `analytics-session-projection` (SESSION), `analytics-datasource-projection` (DOMAIN) and optional `analytics-report-delivery` (DOMAIN). Disabled projections do not start consumers and do not acknowledge/discard retained events. Events outside NATS retention require an operator backfill; do not replay privacy-erased projections.
5. Grant `read:Report` for dashboards; campaign/team ABAC and inverted deny rules are applied before aggregation. `export:Report` is also required for CSV, XLSX and BI. Agent breakdown needs scoped `reveal:Session`; identities remain HMAC pseudonyms. Scheduling requires `manage:Report` and an active human owner.
6. Admin: select **Analitik / Analytics** in the navigation. Designer: `/analytics`, or turn on **Isı haritası / Heatmap** in a pinned screen editor. The heatmap covers the last seven UTC days and exact version/page/node IDs; it does not attribute old-version timings to an edited draft.

### ClickHouse (optional)

Provision `clickhouse.sql`, then set `ANALYTICS_STORAGE=clickhouse`, `ANALYTICS_CLICKHOUSE_URL` (private HTTPS endpoint), `ANALYTICS_CLICKHOUSE_USER` and `ANALYTICS_CLICKHOUSE_PASSWORD`. Credentials are server-only. Statements are fixed and use typed HTTP query parameters for tenant/date/session IDs. `ReplacingMergeTree` with `FINAL` makes repeated cross-store inserts logically idempotent. PostgreSQL remains the control plane, replay/dedup ledger and fail-safe projection; switching stores requires a controlled projection backfill before reads switch. Cross-store commit is not a distributed transaction; uncommitted ClickHouse inserts can be visible until a retry settles. Both stores must be monitored, retained and erased. Never connect external BI directly with this shared service credential.

### Scheduled email reports

Set `ANALYTICS_REPORTS_ENABLED=true`, `ANALYTICS_SMTP_URL` to an operator-controlled SMTP/SMTPS transport and `ANALYTICS_MAIL_FROM`. No email is sent during code generation or tests. The scheduler runs once per minute with `FOR UPDATE SKIP LOCKED`, creates an outbox job, and advances the schedule atomically. Daily schedules use the selected UTC hour; weekly schedules use Monday. Reports cover a rolling interval with the same length as the saved filter, ending on the prior UTC day. Recipient IDs are tenant user references in the control plane, never analytics facts. The sender looks up addresses at delivery and intersects the **current** owner/recipient read+export permissions for each recipient; role revocation stops data disclosure. Addresses and report bodies are not logged. SMTP delivery is at least once: stable Message-ID helps receiving systems dedupe, but a crash after SMTP acceptance and before transaction commit can cause a repeated email. Configure mail transport/timeout and consumer alerting accordingly. Recipients without active accounts or export permissions receive no data.

### Retention and privacy

Maintenance uses `tenants.settings.audit.analyticsRetentionDays` (default 365 days), takes a shared lock on the tenant settings, and respects legal hold. Invalid settings fail safe and prevent purge. Maintenance runs when analytics is enabled, independently of scheduled mail. PostgreSQL rows and ClickHouse rows are both removed. The admin customer anonymization workflow removes projections for matched session IDs and records tenant-bound tombstones; retained NATS events cannot recreate them. Direct identifiers, ANI, participants, variables, input/output bodies, notes and addresses are excluded from facts by strict Zod projection. HMAC agent references are pseudonymous personal data and remain subject to access controls/retention, rather than being advertised as legally anonymous.

## Read and export APIs

- `GET /v1/analytics/dashboard?from=2026-10-01&to=2026-10-03` with optional `campaignId`, `scriptId`, `channel`, `teamId`.
- `GET /v1/analytics/export/csv` or `/xlsx`, with the same filters. CSV neutralizes formula prefixes; XLSX creates actual worksheets, not renamed CSV.
- `GET/POST /v1/analytics/schedules`, `DELETE /v1/analytics/schedules/:id` (own schedules only, audited writes).
- `GET /v1/analytics/odata`, `/$metadata`, `/Scripts?from=...&to=...&$top=100&$skip=0&$count=true` with optional `$select=key,sessions,completionRate`. This read-only OData v4 subset supports metadata and bounded projection/paging; `$filter/$expand/$orderby`, arbitrary SQL and write operations are rejected. Use a scoped authenticated service client for BI, not browser tokens or direct multi-tenant database credentials. Grant canonical `read:Report` + `export:Report` to a dedicated BI service client. Unconditional service scopes may only be delegated by an administrator holding an unconditional permission with no scoped deny restrictions; custom scoped BI users should use the BFF read session.

## Metric semantics

- Date filters select **sessions whose start event is present in the UTC interval**. Metrics are observed as of events in the same interval; a session still open at the cutoff does not count as completed. Requests are limited to 366 days and 50,000 events; too-large queries return validation errors instead of silently sampling or undercounting. Narrow filters/date ranges for interactive use; large-scale preaggregated warehouse reporting remains a follow-up.
- Completion = latest observed state `completed` / all cohort sessions. Mean duration includes terminal sessions with start and end observations. Active-session mean dwell is not imputed.
- Page dwell closes at next page entry or terminal event. Drop-off = abandoned/expired sessions ending on that page / distinct sessions visiting it. Repeated visits contribute dwell samples, not duplicate drop-off sessions. Sankey shows frequent **adjacent transitions**; split source/target copies avoid cyclic layout failures.
- Data-source metrics come from the real integration executor, including failed calls; request/response/error bodies never enter analytics. The stable tenant integration ID is the dimension; the pinned script reference/version is verified before execution.
- Required-read denominator is the distinct mandatory node IDs on visited pages; acknowledgment/unchecking changes the numerator. This is agent acknowledgment evidence, not proof that a person read a text; document-driven hidden mandatory nodes may be counted conservatively.
- Field dwell measures focus-to-blur for bound input controls, capped at 300s. `aria-invalid` is the local error indicator. Offline observations are best effort and currently not durably queued; no field value is transmitted. Read events are writer-fenced and schema/node validated.
- A/B variants use the launch decision's saved variant key and assignment ID. Two-sided pooled two-proportion z tests require all four contingency cells >=5, use p<0.05, and apply Bonferroni correction within each experiment. Drafting a new experiment should create a new assignment ID. No causal claim is made for observational session comparisons.
- Supervisor updates poll every 10s (plus NATS delivery lag); observations older than 30 minutes are excluded from active counts. Full session IDs are technical references; customer/agent names are never returned.

## Sequential A/B, guardrails, release impact and insights

Added 2026-10-07 ([ADR-0048](../adr/0048-sequential-ab-inference.md)). Comparisons keep the fixed-horizon
`pValue` and add `anytimePValue`/`anytimeSignificant` (normal-mixture mSPRT, τ = 0.05, ≥ 30 sessions per
arm): read these while an experiment is running. `guardrails` compare abandonment and required-notice
compliance separately and name the significantly worse arm. `versions` lists outcomes per published
version in release order with a comparison against the previous version of the same script
(observational: time and traffic mix are not controlled). `insights` are ranked, thresholded pointers
(drop-off, slow page, failing field, slow or failing data source; ≥ 30 samples) with fixed kinds and
no free text. Canary rollouts and bandit advice reuse these results
([ADR-0049](../adr/0049-canary-rollout-on-ab-assignments.md)): `GET /v1/assignments/:id/rollout` and
`GET /v1/assignments/:id/allocation`.

## Verification (commands only; not run)

```sh
pnpm test:analytics
pnpm test:analytics --integration             # Docker: PG/Redis/NATS Testcontainers setup
pnpm --filter @verbis/ui exec vitest run src/components/analytics-dashboard.spec.tsx
pnpm --filter @verbis/ui exec playwright test e2e/analytics.spec.ts
pnpm --filter @verbis/admin-web exec playwright test e2e/analytics.spec.ts
```

API unit/tenant RLS, schema/PII, replay/statistics/export tests, UI keyboard/permission tests and Playwright axe/visual tests are authored. Browser snapshots must be reviewed and generated in the project's normal visual regression workflow; no snapshot baseline or zero-axe claim is implied by writing tests. TimescaleDB and ClickHouse adapter deployment tests and SMTP crash/retry exercises remain unexecuted.

References: [Timescale hypertables](https://docs.timescale.com/api/latest/hypertable/create_hypertable/), [ClickHouse ReplacingMergeTree](https://github.com/ClickHouse/docs-reference/blob/master/docs/en/engines/table-engines/mergetree-family/replacingmergetree.md).

## Checks performed in this implementation turn

API, admin-web, designer-web and agent-web type checks passed. Shared UI/core-runtime builds and admin/designer production builds passed; targeted lint for new analytics files and modified API wiring passed. OpenAPI and Designer API types were regenerated. The full UI-package typecheck still reports pre-existing Storybook 8 imports and test interop errors outside this analytics implementation. No tests, browser checks, migrations or mail sends were run.
