# ADR-0038: Production integration mocks and optional cache recovery

Status: Accepted (2026-10-05)

The enterprise core release must not report a production business action as successful by
executing a configured simulation. The datasource definition keeps its mock configuration for
designer previews and explicit dev/test calls. A live call with environment `prod` and an
enabled mock now fails closed with trace error `MOCK_FORBIDDEN`, no value, no secret read and no
upstream request. It does not silently disable the mock and send an unexpected real request.
An explicit preview remains a simulation and its trace retains `mock=true`.

This tightens previous behavior: tenant-enabled mocks formerly also ran on live production
calls. Operators must disable mocks before enabling live production execution. Request and
document schemas remain unchanged; the trace error is additive. Runtime binds the environment
server-side rather than accepting the caller's environment selection. The existing audit path
records a failed datasource execution when its trace contains an error.

Integration GET cache is an optional acceleration layer. A JSON decoding or output-schema
validation failure in a cache entry becomes a cache miss. The live response still goes through
normal authentication, SSRF/egress controls, timeout/retry/breaker and output validation; a
valid result replaces the obsolete entry. A schema-invalid live response remains a failure,
not a cache fallback. Cache connection failures already followed the same live-read policy.

Regressions first reproduced a production mock success and two corrupt/obsolete cache failures.
Tests verify prod refusal, dev/test mock compatibility, validated live recovery, and refusal of
schema-invalid live output. This decision does not certify external vendor APIs or target
production infrastructure.
