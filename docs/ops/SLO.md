# Verbis service objectives

Status: implementation ready for validation; no measurements recorded (2026-10-03).

| Objective | Target | Window | SLI |
| --- | --- | --- | --- |
| Agent screen opening | p95 < 1 second | rolling 30 days; 10-minute operational alert | `agent.screen.open` from secure redemption start until initialized script and two animation frames |
| API availability | 99.95% | rolling 30 days | valid HTTP requests served without 5xx / all valid HTTP requests |

API excludes health probes and unmatched routes from the contractual denominator. Expected
client failures (4xx, including rejected unauthorized launches) count as available responses.
Network failures before API ingress require a separate synthetic edge probe; server RED metrics
cannot observe them. The API SLI is an ingress response SLI, not a claim of total network availability.
A 30-day time-based interpretation permits 21.6 minutes of downtime; the implemented request-based
budget permits 0.05% failed requests. The two budgets are not interchangeable.

Agent opening excludes unsuccessful redemption, preview, background tabs, SSO login time and
browser reload/resume. Cold bundle loading before JavaScript runs is assessed with Lighthouse;
real launch acceptance uses authenticated browser tests. k6 measures an API-only proxy and cannot
prove browser rendering p95. `verbis_trace_duration_seconds_bucket{span_name="agent.screen.open"}`
is converted from actual browser spans by the collector. Backend sampling does not affect RED
counters; browser traces use full sampling for this SLI. Failed opens remain error spans.

Calculate 30-day p95 with `histogram_quantile(0.95, sum by(le)(increase(
verbis_trace_duration_seconds_bucket{span_name="agent.screen.open",status_code!="STATUS_CODE_ERROR"}[30d])))`.
API SLI uses `1 - sum(increase(verbis_http_requests_total{service_name="verbis-api",status_class="5xx",route!="unmatched"}[30d])) /
sum(increase(verbis_http_requests_total{service_name="verbis-api",route!="unmatched"}[30d]))`.
Zero traffic or absent telemetry means **no data**, never 100% availability.

If error budget is exhausted, stop nonessential releases, identify failures with traces,
restore service and record incident/remediation. ApiSloBurn pages on sustained 14.4x budget
consumption over both 5-minute and 1-hour windows. Production retention must exceed 30 days
(dev Prometheus retains 7 days). Review SLOs monthly with operations.
