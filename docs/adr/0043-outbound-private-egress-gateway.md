# ADR-0043: Outbound-only private egress gateway

Date: 2026-10-06. Status: accepted for an opt-in first slice.

## Context

R-X1 and differentiator 7 need customer-network HTTP and database access. Broadening the core API's SSRF allowlist would expose cloud metadata and unrelated internal services.

## Decision

Keep the core public transport's SSRF checks. An operator explicitly enables `PRIVATE_EGRESS_ENABLED` and provisions a dedicated tenant service client using `tls_client_auth` with exactly `execute:Integration`. DataSource `privateGateway.clientId` binds every job to that client. The customer worker has no listener; it polls the mTLS API and completes jobs over the same outbound connection.

Requests and responses are sealed in Redis with a domain-separated keyring and AAD containing tenant, client, job and record type. Queue creation is atomic and bounded to 1000 pending jobs per client; request/lease records expire with the request deadline. Results expire after 15 seconds and are consumed once. Claim removes the request atomically. Completion requires the tenant/client context, certificate-bound principal, an unexpired random single-use lease and the request's byte limit. Abort/timeout cleans the request, lease, result and queue entry. Redis supports multiple API replicas sharing the keyring; jobs are not redelivered after worker failure because private POSTs must not be duplicated.

HTTP targets require the intersection of tenant/source exact origins and worker-local origin/CIDR configuration. The worker rejects every DNS answer outside permitted RFC1918 IPv4 CIDRs, including mixed answers; loopback, link-local, metadata, public and IPv6 addresses are denied in this first slice. DNS is pinned to the checked socket address. Redirects remain disabled. HTTP credentials and custom CA files stay local; auth headers from a job are stripped before local credential injection. SQL uses ADR-0042's named catalog. Source auth must be `none`; the API does not distribute private upstream credentials.

Job bodies/results bypass generic audit body capture and idempotency response persistence. The normal DataSource execution audit retains identifiers, outcome, safe error codes and duration only. Encrypted transient payloads may still contain business PII and must follow the deployment's Redis retention/access policies.

## Operation and limits

See [private gateway runbook](../integrations/PRIVATE_EGRESS.md). Default is disabled; there is no public-network or direct SQL fallback. Worker errors return a generic upstream failure without query/credential text. The first worker processes jobs sequentially and backs off on API failure; shard dedicated clients/workers for independent target groups. A deadline or network failure after an HTTP write can have an uncertain upstream outcome; no exactly-once write claim is made.

Follow-ups: resumable leasing for proven idempotent reads, worker health/queue metrics, richer local credential providers, bounded concurrency, IPv6 support, and customer-network load/failure acceptance. Local tests do not establish production latency or regulatory certification.
