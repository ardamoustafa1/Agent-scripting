# Performance validation

2026-10-03: **tests, k6, Lighthouse, benchmarks and migrations were not run, at the user's request.**
No throughput, p95, Lighthouse score or measured bottleneck claim is made.

## Workload and commands (not executed)

`infra/k6/agent-load.js` holds 5,000 independent VUs for twenty 180-second interaction slots:
100,000 interactions over one hour, 500,000 page commands and 300,000 web service executions.
Each cycle performs mTLS client-credentials launch-intent creation, SSO cookie/CSRF redemption,
writer attach, five pages, three BFF data-source executions and outcome submission. Rejected
launches, write fencing, idempotency and tenant controls remain enabled. Initial starts are a
5,000-agent burst; 65 minutes allows late cycles to finish. The completed counters must match
the requested totals; validate actual start/end timestamps before declaring 100k/hour.
The profile represents 5,000 signed-in agent processes, **not 5,000 continuously active runtime
sessions or sockets**; `infra/k6/agent-socket-soak.js` separately holds 5,000 distinct active runtime sessions and
origin-bound Socket.IO connections for one hour. Each fixture must have a securely launched
`sessionId`, and session/BFF expiry must exceed the soak. The test validates the real
Engine.IO handshake, one-time runtime ticket, resume event and heartbeat; unexpected disconnects fail.

Prepare an isolated staging tenant with 5,000 SSO users (sessions valid for the entire run), a
published five-page script, three allowed mock HTTP upstream data sources (engine mocks OFF),
connector mappings, 20 distinct connected synthetic interactions per agent and a disposition
without required fields. The connector simulator must ACK writebacks. Provision these via normal
admin/import/simulator tools; no credential fixture or customer data is committed. Copy the
shape in `infra/k6/fixture.example.json` into a secret file outside Git, expand all users and
interactions, and populate SSO cookies/CSRF tokens. The mTLS OAuth client needs existing Session
permissions and a CA trusted by staging. Configure staging capacity for this tenant via existing
administration; never disable authorization, rate limits or replay checks. Deploy the migration
and drain legacy runtime writebacks before establishing a new queue baseline.

```sh
mkdir -p test-results
K6_BASE_URL=https://staging.example K6_AGENT_FIXTURE=/secure/agents.json \
K6_CLIENT_CERT=/secure/client.pem K6_CLIENT_KEY=/secure/client-key.pem \
k6 run infra/k6/agent-load.js
K6_BASE_URL=https://staging.example K6_AGENT_FIXTURE=/secure/socket-agents.json \
k6 run infra/k6/agent-socket-soak.js
# Small authored smoke profile: K6_AGENTS=5 K6_ROUNDS=1 (still a 180s slot).
pnpm --filter @verbis/agent-web... build
pnpm --filter @verbis/agent-web exec lhci autorun --config=../../lighthouserc.cjs
pnpm --filter @verbis/observability test
pnpm --filter @verbis/api test:unit
pnpm --filter @verbis/api test:integration
```

Results are saved to `test-results/k6-agent.json` and `test-results/lighthouse/`. Test commands are
provided for later use only. Lighthouse CI gates median performance ≥95 and worst accessibility
100 across three runs of the built unauthenticated shell; real authenticated script/axe acceptance
must also pass the existing Playwright suites. Enable browser collection with `VITE_OTEL_ENABLED=true`.
LCP, INP, CLS, FCP and TTFB are exported as metadata-only web-vital spans, with no DOM attribution.

## Static findings and changes

- Desktop bootstrap previously loaded the full session/version/interaction graph twice. It now
  passes the authorized loaded row to `viewFromRow`, retaining masking and supervisor read audit.
- PostgreSQL pool retains a cap of 20 per process; adds a 2s acquisition timeout and 30s idle cleanup.
  Gauges show used/idle/capacity and waiters. Budget replicas ×20 plus audit, background and migration
  pools below the database connection limit. A timeout is containment, not proof of higher throughput.
- New outcome/recording jobs use `runtime-writeback`; expiry jobs stay on `runtime`. This avoids
  counting future expirations as pending writebacks and prevents expiry traffic consuming the same
  worker budget. Legacy runtime workers still drain old writebacks; deployment should drain old jobs
  before relying on the new backlog gauge. BullMQ cardinality counts avoid O(backlog) Redis scans.
- Existing tenant/version/session/credential-scoped integration GET cache and runtime snapshot cache
  remain in place. No cross-session cache sharing or PII caching was introduced.
- Index changes are deferred until EXPLAIN evidence exists; speculative indexes can slow event writes.
  Active-session aggregate uses a column-restricted NOLOGIN monitoring role and a count-only function;
  FORCE RLS and the application's existing tenant policies are preserved.

## Measurement record

| Metric | Before | After | Status |
| --- | --- | --- | --- |
| Agent rendered opening p95 | not measured | not measured | pending authenticated browser run |
| API-only opening p95 | not measured | not measured | pending k6 |
| Interaction throughput | not measured | not measured | target 100,000/hour |
| Peak authenticated agents | not measured | not measured | target 5,000 VUs |
| API 5xx ratio | not measured | not measured | target <0.05% |
| Lighthouse performance/accessibility | not measured | not measured | target ≥95 / 100 |
| Writeback ACK lag / backlog | not measured | not measured | pending simulator soak |

Record commit SHA, dataset size, tenant count, replicas/resources, PG/Redis/NATS versions, pool
configuration, generator CPU/network, time window, exact counts, dropped/late cycles, p50/p95/p99,
error classes, connector ACK and dashboards. Capture slow-query `EXPLAIN (ANALYZE, BUFFERS)` only
in staging. Inspect pool waiters/event-loop delay before increasing replicas; inspect NATS lag and
retry/failed queues before raising worker concurrency. Any index/cache change requires before/after
measurements with the same fixtures. Snapshot/reference masking and RLS must remain enabled.

References: [k6 executor model](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/),
[OTel browser SDK](https://opentelemetry.io/docs/languages/js/getting-started/browser/).

## Enterprise Core acceptance preparation — 2026-10-05

The current first-release target is **2,000 distinct concurrently active agents**, not a measured
capacity. Core disables collaboration/vendor hub/live AI. The earlier interaction profile above
remains a separate vendor/simulator extension profile; it is not a core release acceptance test.
The socket profile now defaults to 2,000 VUs. Default HTTP endpoints use the Helm edge's `/api`
prefix while Origin and `/socket.io/` use the bare HTTPS origin. `K6_API_PREFIX=''` is only for
an approved direct API ingress; `K6_SESSION_COOKIE_NAME` can override the default
`__Host-verbis_session` with the deployment's secure BFF cookie name.

Before any load, create a protected fixture **outside the repository**, using normal SSO and
secure launch workflows. For socket soak, each entry needs a different authenticated user,
BFF session cookie, CSRF token and already launched/active runtime session. A copied session
is rejected even when unrelated cookies differ. Synthetic IDs alone do not authorize sessions.
Session/BFF expiration and runtime idle policy must support the entire run. Preflight validates
shape/uniqueness only; ticket issuance still checks real authorization and session state.
The committed example is deliberately rejected until its placeholders are replaced. Do not
paste session credentials in chat or logs. Run only against the isolated staging environment.

```sh
chmod 600 /secure/socket-agents.json
mkdir -p test-results
export K6_BASE_URL=https://staging.example
export K6_AGENT_FIXTURE=/secure/socket-agents.json
export K6_AGENTS=2000
export K6_SOAK_SECONDS=3600
node scripts/k6-preflight.mjs socket
# Only after the read-only preflight and staging fixture provisioning succeed:
k6 run infra/k6/agent-socket-soak.js
```

All numeric parameters must be positive safe integers. One-hour soak has a 3,900-second
executor deadline; two-hour soak has 7,500 seconds. Full identity validation runs once inside
SharedArray initialization, not once for every VU. Required completed iteration counts catch
aborted/unfinished VUs. Reports distinguish expected and observed counts and require every
configured threshold to pass; absent metrics or thresholds cannot produce `accepted: true`.
`K6_RESULTS` selects the output path for either profile. `accepted` means this workload's
checks passed, **not** general enterprise/HA/SLA acceptance. Standard k6 summary format is used;
new experimental machine-readable summary shapes fail closed until supported and tested.

The socket run checks tickets, resume and heartbeat holding; it does **not** execute REST sources,
edit/publish/rollback scripts, exercise reconnect or establish load-generator/cluster health.
Core mixed REST + session workload and controlled process loss/reconnect require a separate
staging fixture/run; these gates remain open. The vendor profile still needs its mTLS launch
identity, connector mappings, connected interactions and writeback ACK monitoring. The SPA edge
strips client-certificate headers; do not relax that control to force a vendor load test through
it. Configure the approved service-authenticated ingress before that later vendor acceptance.

Local verification: `pnpm test:policy` now includes fixture/report/preflight regressions. When k6
is available, bounded offline harnesses execute real k6 counters/thresholds and both full scripts'
initialization. No application requests occur in these harnesses; they are not a 2,000-agent
capacity run. Detailed evidence: `docs/verification/LOAD_ACCEPTANCE_PREPARATION_2026-10-05.md`.

Summary and executor contracts checked against official documentation:
[k6 custom summary](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/),
[per-VU iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/).
