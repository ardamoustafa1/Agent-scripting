# ADR-0040: Authoritative routing context, cache revisions and session admission

Status: Accepted (2026-10-06). Refines ADR-0015 and secure launch; public script resolution
and connector event changes are additive. Existing unsupported assignment predicates are now
rejected on write; historical rules fail closed during resolution.

Connector SDK events carry an optional `routing` object with locale, skills, segment and a
stable experiment key. Canonical allow-listed platform attributes `locale`, comma-separated
`skills`, `segment` and `routingKey` are promoted into this object; explicit routing fields take
precedence. Locale casing is normalized. The API encrypts these dimensions in the existing
tenant/interaction-bound envelope together with attached data. Omitted routing/customer fields
on lifecycle events preserve the previous values; an explicit empty routing object clears the
routing dimensions.
Secure launch opens this envelope server-side and forwards the validated dimensions and flat
attached facts. Browser launch requests still cannot provide routing identities or script IDs.

A/B uses the trusted explicit key, otherwise a tenant-scoped SHA-256 customer identifier, otherwise
the interaction ID. No routing API decision falls back to the agent ID or an empty constant.
Missing keys route the assignment's normal version, omit `variant`, and trace
`abSkipped: missing_sticky_key`. An unavailable/unpublished/retired variant pin similarly uses
the normal version with `abSkipped: variant_not_published`; analytics never labels this as the
unavailable experiment arm. These fallback sessions are excluded from per-arm attribution.

Campaign hours are a gate: closed schedules return `no_match: outside_working_hours`. Only a
null schedule means always open. Malformed stored schedules produce an observable sanitized
log/metric and `VERBIS_ROUTING_CONFIGURATION_INVALID` (503), preventing silent always-open
routing. Time zones, exclusive closing boundaries and holiday rules remain unchanged.

Assignment `matches` uses the existing `@verbis/expr` RE2JS implementation with bounded pattern
and input lengths. Admission compiles every matches pattern and rejects unsupported syntax,
including backreferences/lookaround. Entire predicate trees are inspected before evaluation so
invalid or unsupported branches cannot become true through negation or short circuiting. `$expr`
is rejected on create, patch, batch and legacy `rule` aliases until a routing-specific expression
scope is implemented. No arbitrary expression is silently accepted and then permanently skipped.

Redis generations remain an optimization. Each snapshot key also carries a PostgreSQL fingerprint
of campaign/assignment metadata, script status/release heads and version state/checksum metadata.
Every hit reads the fingerprint; every multi-query miss compares it before/after loading. Racing
loads retry at most three times and then return a visible conflict rather than stamp mixed data.
This observes committed changes without waiting for NATS or TTL. Invalidation failures throw so
the transactional consumer rolls back and retries delivery. Query fingerprints exclude script
version documents; they include relevant metadata even for direct maintenance writes.

Session admission uses a short independent RLS transaction and a durable future-session
reservation. `FOR NO KEY UPDATE` serializes admission/policy changes only during allocation;
it does not conflict with session foreign-key key-share locks. One MVCC statement counts active
sessions plus pending reservations, preventing an undercount during consumption. A session
INSERT trigger consumes its reservation atomically; rollback retains the reservation. Leases
expire after two minutes, longer than the API's 15-second request transaction limit. Expired
leases cannot be consumed, and the next admission clears them. Failed launches can temporarily
hold capacity until expiry. All production session-creation paths use admission; privileged
maintenance inserts are not an authorization boundary for this application-level quota.

New RLS-protected reservation storage and partial session `(tenant_id,state)` and
`(tenant_id,interaction_id)` indexes are migrated and drift-tested. Admission bookkeeping is
covered by the enclosing launch success/failure audit; no new public mutation API is added.
User/script quota behavior is unchanged. Admission still serializes briefly per tenant and counts
indexed rows; a dedicated active counter is a future optimization if production load requires it.

Acceptance: deterministic/property regressions plus disposable PostgreSQL/Redis/NATS integration.
Shared development data is preserved. Remote CI, real vendor routing and distributed production
load acceptance remain open; local tests do not establish those release gates.
