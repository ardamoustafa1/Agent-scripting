# ADR-0037: Anonymous browser security journal

Status: Accepted (2026-10-04)

Tenant audit events require a verified tenant context. A browser blocks a foreign iframe before
any application code or authenticated session exists. Assigning that observation to an arbitrary
tenant would forge audit attribution and allow anonymous cross-tenant audit pollution.

The enforced CSP now sends same-origin legacy CSP reports to `/api/v1/security/csp-reports`.
The edge caps requests at 16 KiB, limits request rates and removes credentials. The public API
validates a bounded report and drops document paths, queries, credentials, fragments, referrers,
blocked URLs and policy nonces. It persists only origin, directive, disposition, receipt time and
server correlation ID as an explicitly **untrusted browser report**. Reports do not authorize
anything, and they do not prove that a reported document/origin belongs to the sender.

`AuditService.recordSecurityReport` waits for a file-backed JetStream acknowledgement before
returning 204. The separate SECURITY stream retains signals for 90 days, rejects ordinary delete
and purge requests, and rejects new records at its 1 GiB bound instead of silently evicting old
records. Storage outage/full capacity is a failed receipt, never a false success. Quorum replica
count follows the deployment's `NATS_STREAM_REPLICAS`. Privileged NATS operators can still change
stream configuration; external WORM archival and operational access controls remain deployment
acceptance responsibilities. This journal is not represented as the PostgreSQL tenant hash chain.

Cookie CSRF/origin denials with a verified stored session continue to use the PostgreSQL tenant
hash chain, with their real tenant/user attribution and a separate committed transaction. The
request is never assigned an authorized principal when rejected.

The real nginx/Chromium regression now asserts both frame blocking and the exact persisted
frame-ancestors signal in SECURITY; it no longer expects a tenant DB event for an anonymous frame.
This replaces the impossible attribution assumption in V2-SEC-002 while preserving durable
security-event acceptance. Browser reports are best effort: browsers that disable or do not
support CSP reporting cannot promise delivery of every local enforcement decision.
