# ADR-0016: Sequenced runtime sessions and origin-bound realtime grants

- Status: Accepted
- Date: 2026-10-01

## Decision

Keep `launching` as the existing Created wire/DB state and add `paused` without renaming existing
states. Runtime never creates sessions: secure launch initializes a pinned row in its tenant
transaction. A committed `sequence` mirrors the existing hash-chain head; row locks plus CAS
serialize agent and platform changes. Every mutation writes audit/outbox in the same transaction.

One tab holds a 60-second writer lease fenced by a random token hash, tab UUID and BFF session.
Second tabs and supervisor watches remain read-only. Socket.IO uses a Redis adapter for fanout
and short-lived, origin-bound, single-use tickets; NATS/outbox events and DB replay provide
reconnect recovery. Revalidation checks BFF revocation and current tenant/ABAC access every
15 seconds. Commands remain HTTP requests through the BFF/CSRF/RLS pipeline.

PII state and disposition fields use tenant-bound envelope encryption; PCI tokens are only
local ephemeral memory, not Redis or persistent snapshots. The existing rotating identity
keyring wraps runtime DEKs; KMS-backed wrapping can replace this provider later. Platform events
carry encrypted normalized interactions, while outbound runtime events carry redacted metadata.
Provider token verification and connector writeback/recording APIs are server-only ports with
fail-closed defaults and stable idempotency keys. BullMQ manages deadline checks and retries.

## Consequences

The additive migration and launch initialization hook must be deployed together. Previously
plaintext session variables are not read automatically. Redis loss recovers persisted state;
volatile variables and secure tokens must be reentered. Frontends buffer and deduplicate events
around resume watermarks. Team-scoped watches require trusted launch-time team assignment.
Concrete connector/token-provider wiring belongs to the adapter and secure-launch steps.
