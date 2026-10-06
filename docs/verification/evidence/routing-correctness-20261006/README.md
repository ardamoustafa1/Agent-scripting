# Routing correctness evidence — 2026-10-06

Scope: M-03…M-10, T-05, T-16. See [verification report](../../ROUTING_CORRECTNESS_2026-10-06.md) for behavior and remaining acceptance.

All logs come from local commands; infrastructure integration tests use disposable Testcontainers services. ANSI escapes and trailing whitespace were removed without changing results. `SHA256SUMS` covers the changed source, contracts, documentation and the evidence files at this commit.

## Before and after

- `regression-before.log`: first routing/quota/cache unit and property run, 14 failed / 127 passed.
- `context-before.log`: SDK routing propagation regression failed before implementation.
- `designer-before.log`: assignment fact-mode and legacy-expression regressions, 2 failed / 23 passed.
- `integration-baseline.log`: previous committed launch/resolver/snapshot/domain-resolver/quota code temporarily restored; only the new reservation helper export remained so the new tests could import it. Cache freshness and the tenant-lock probe failed, 2 failed / 34 passed.
- `launch-context-baseline.log`: only the previous launch implementation restored, with explicit cache invalidation isolating routing propagation; redeem returned 422 instead of 201, 1 failed / 20 filtered. Filtered tests are not acceptance evidence. All implementation files were restored before the final runs.
- `integration-final.log`: 45/45 PostgreSQL/Redis/NATS integration tests, including context retained through a held event, metadata invalidation, concurrent reservation/expiry/rollback and migration RLS/drift.
- `unit-final.log`: 154/154 targeted unit/property tests.
- `designer-chromium-axe-final.log`: 10/10 Chromium tests including assignment and release accessibility.

## Quality gates

- `test-final.log`: 32/32 root tasks, 30 cache hits; API 1927 and Designer 368 tests passed.
- `lint-final.log`: 33/33 root tasks.
- `typecheck-final.log`: 32/32 root tasks, rerun after the final integration test assertion.
- `format-final.log`: repository formatting passed.
- `coverage-final.log`: all 18 workspace coverage thresholds passed without changing thresholds.
- `inventory-final.log`: 2/2 audit inventory tests passed.
- `openapi-final.log`: API and documentation contracts generated together.
- `designer-build-final.log`: production Designer build passed; the existing large-chunk warning remains.

No remote CI, vendor or production/HA load acceptance is claimed by these local logs.
