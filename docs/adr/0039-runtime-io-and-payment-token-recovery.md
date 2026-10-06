# ADR-0039: Runtime I/O, payment references and observation lifecycle

Status: Accepted (2026-10-06)

Runtime datasource HTTP calls use owned tenant transactions. Preparation validates the owner,
writer claim, session sequence and exact datasource pin in a short RLS transaction. Execution
runs after it commits; credential metadata/access audit uses separate short transactions and
Vault decryption also runs outside them. A second transaction rechecks the writer claim and
sequence before recording the runtime activity. A late result after a writer/page/session change
is discarded; the completed integration attempt remains audited. Upstream failure activity is
committed before the RFC 7807 error is returned. Fallback remains available but counts as failure
in runtime activity and analytics.

The integration policy is total deadline → bulkhead (bounded queue) → breaker → retry →
per-attempt timeout. The total deadline includes one attempt of queue allowance and bounded
backoff, capped at 120 seconds. Only the existing idempotent REST methods retry. Each source's
script-side timeout can cancel the browser earlier; authors must allow enough time for the
configured retry budget. SSRF, credentials and response validation remain mandatory. Policy
capacity is 1,000 entries with individual LRU eviction, preserving other tenants' breaker state.

This supersedes the local-memory retention of PCI-classified runtime variables. Hosted capture
continues to verify signed, session/tenant/variable-bound single-use receipts. Verbis retains
only the verified `tok_` reference, encrypted with the existing tenant/session-bound envelope in
PostgreSQL and the generation-bound Redis cache. Raw PAN/CVV and arbitrary payment strings
remain forbidden. A valid reference survives replica changes and cache loss, even when the
variable's general-purpose `persist` flag is false; it is removed on page leave and terminal
transition, redacted from every browser view, and excluded from event/audit/analytics payloads.
The PSP owns payment data and token validity. No raw payment memory map or 60-second local TTL
remains. Cache write failure is observable and fails closed when payment references are present.

Collaboration authenticates on connect, renews room leases and checks author permission every
10 seconds, and validates current permission/version/composition/schema again at save. Message
and awareness hooks do no tenant SQL or Redis work. A per-update in-memory Yjs size check keeps
the two-MiB room limit; semantic/schema validation and linked-content checks run at persistence.
Invalid edits cannot be stored; semantic errors permit correction, conflicts freeze the room.
Listener failure affects readiness and emits a sanitized log and bounded-label metric.

Supervisor polling is replaced by the existing read-only runtime channel, with a 10-second
fallback while disconnected. The session list refreshes every 30 seconds; terminal watch states
stop periodic reads. Observation start/stop is audited once per socket connection; reconnects
form new observation periods, not one event per snapshot. Failed stop auditing is logged and
metered. Terminal agent views do not poll; outcome ACK is delivered through transactional outbox
and the runtime channel, preserving writeback feedback. A queued ACK can reconnect until it
arrives; an acknowledged terminal session stops reconnecting.

Connector receipts retain at most 20,000 commands. Advisory launch/load trackers retain at most
50,000 interactions, expire after two hours on activity/snapshot sweeps, and use direct
interaction-indexed cleanup. TTL/eviction may undercount unusually long or idle interactions;
the platform remains routing authority. Server-side push launch dedupe serializes the
(tenant, interaction, user) tuple in PostgreSQL and reuses a valid pending or redeemed intent
across hub replicas/restarts. Expired pending intents can be replaced; fragment launches keep
single-use delivery behavior. Genesys overflow resync IDs remain queued on failure with a
single bounded-backoff timer; shutdown cancels it.

Local regression, database, browser/axe and coverage acceptance does not certify external PSP,
vendor, distributed deployment or production load behavior. Those release gates remain open.
