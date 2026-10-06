# Operational telemetry and alert response

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` and protocol `http/protobuf` on API,
connector-hub and audit-worker. Defaults distinguish service names; do not share one
`OTEL_SERVICE_NAME` across processes. Sidecars include the official Spring OTel starter, JVM/HTTP
instrumentation and explicit NATS producer/consumer spans with W3C headers. Configure their
collector endpoint and keep logs exporter disabled. Licensed vendor socket SDK internals are
outside auto-instrumentation; the surrounding command/event spans provide correlation.

API/worker already propagate outbox W3C context through NATS. Hub preserves event context through
its delivery queue and injects request/reply headers. Browser SDK wraps allow-listed same-origin
API requests only, adds traceparent/tracestate, and uses a fixed same-origin traces-only proxy.
API CORS accepts these two headers; baggage is never propagated by the browser. Browser telemetry
is untrusted operational input and must never be used for authorization/audit/security decisions.
Nginx proxy limits rate/body/method and strips cookies/authorization before forwarding to collector.
Production BFF/proxy topology must wire both `/api` and `/telemetry`; the existing static nginx API
placeholder still returns 404 until deployment connects the BFF. Dev Vite provides both proxies.

Node export removes URLs, queries, statements, parameters, exceptions and headers **before** OTLP
transmission. Collector applies a second allow-list, including sidecar traces; protect its internal
network with TLS/network policy in production. Java exporter customizers also remove URL/SQL/header/error metadata before network export;
its build and vendor runtime validation remain pending. Node/browser never record bodies, credentials, session IDs or user IDs. Metrics use bounded
route/status/protocol/outcome labels. Resource instance IDs distinguish replicas. Use max (not sum)
for global DB session count and shared BullMQ backlog. Metrics are absent on failed observation.

Provisioned dashboards: Platform Genel Bakış, API, Runtime, Connector'lar, Entegrasyonlar,
Audit boru hattı. Alertmanager receives Prometheus rules; dev has a local UI receiver only.
Inject production webhook/mail/pager receiver configuration and retention through the secret/config
management system. No notification is sent by this implementation session.

| Alert | First actions |
| --- | --- |
| HighErrorRate / ApiSloBurn | Scope failing routes; correlate traces; check deployments, pool waiters and dependency failures; roll back implicated release. |
| CircuitBreakerOpen | Inspect upstream availability and credentials; don't force retries on non-idempotent operations. |
| AuditChainVerificationFailed | Preserve rows/checkpoints/WORM evidence; stop affected exports, investigate sequence/hash/signature failures; never rewrite the chain. |
| WritebackBacklog / WritebackDeadLetter | Inspect connector health/ACK and retry errors; restore platform link; replay only with existing idempotency keys. |
| LaunchDenialAnomaly | Inspect deferred launch security audit, mappings and expired codes; retain replay/mTLS controls. |
| AgentScreenSlow | Compare browser launch trace to API/DB/cache spans and bundle LCP; test a representative script. |
| TelemetryMissing | Check SDK enablement, collector health, scrape target and traffic; missing data is not a healthy system. |

The new DB function returns only a global count, is not a public HTTP endpoint, and is granted only
to the application role. Monitor counts every SDK export (15s); evaluate scan cost before production
scale. Apply the migration through the normal deployment process; no migrations were applied here.
For the queue split, finish rolling out all producers/workers and drain legacy runtime writebacks.
Rollback requires keeping a worker on `runtime-writeback` until that queue drains.
