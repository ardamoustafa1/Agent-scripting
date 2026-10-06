# ADR-0028 — Team authoring, release heads and signed package format 2

- Status: accepted
- Date: 2026-10-02
- Scope: Designer lifecycle, collaboration, assignments and environment transport

## Decision

A published ScriptVersion remains immutable. Rollback moves Script.currentVersionId to an older
published version with an optimistic expected-head check, scoped publication permission, author
separation of duties and a fresh scenario regression gate. `latestPublished` resolves this head;
explicit pins and open sessions retain their versions. Resolver cache reads verify heads against
PostgreSQL so rollback is effective before asynchronous invalidation arrives. Legacy snapshots
without any head flags retain their former highest-version fallback; authoritative snapshots fail
closed when no head exists.

Scheduled publication uses an audited transactional outbox event and a BullMQ delayed job. The
worker locks the schedule row and reloads the requester’s current tenant permissions, version
checksum, approval state, authors and scenario results. A domain rejection records a blocked
schedule; infrastructure errors remain retryable. Submission requires the change note already
specified by the shared SubmitVersionSchema; the controller no longer accidentally makes it
optional. Approvers receive scoped in-app notifications. External email/Slack delivery is outside
this implementation.

Yjs is the shared document model, served by Hocuspocus 4 over the same-origin `/collaboration`
WebSocket endpoint. `@verbis/collaboration` owns the framework-independent document bridge. Nodes
and other identifiable objects use shared keyed maps; reorder operations keep the object map
rather than replacing it. Local history uses Y.UndoManager and local origins. Anonymous sockets
cannot read a document: a one-use, origin-bound BFF ticket is additionally bound to tenant,
script and version. Incoming updates are structurally validated, linked content is immutable,
and current session and scoped edit permission are rechecked. Idle connections are rechecked
at most every 10 seconds. Awareness ownership and bounded payloads prevent spoofed users.

A Redis owner lease fences ordinary HTTP saves and lifecycle transitions while a room is open.
Snapshots update the draft, Yjs bytes, draft counter, contributor metadata and audit in one tenant
transaction. Every contributor participates in separation-of-duties checks. The version counter
advances in memory only after commit. Temporary semantic validation errors retain edits in the
room and block snapshot/publication until corrected. Persistent conflicts stop writes. Leaving
collaboration requires a successful explicit flush; the client reloads the authoritative draft
counter before resuming HTTP autosave. Reconnect keeps the same client Y.Doc until synchronization.

Comments are version/node scoped, plain text, optimistic, audited and tenant protected with RLS.
Mentions accept only active tenant members with fresh script-read permission. Comment content,
secret values and CRDT bytes never enter audit metadata.

Signed package format **2** adds integration definition dependencies and secret-reference metadata.
Only non-production profiles are exported; no secret values are included. Verification covers the
original package before mapping. Dependency and secret mappings produce derived draft checksums,
while source signature/checksum and the mappings are retained as provenance. Format 1 signatures
remain verifiable with the original signed part and absent dependency field; missing dependencies
must be provided by the target environment. This changes the package format, not ScriptDocument
schema 1.1.0 or the v1 HTTP route namespace.

## Consequences

The initial deployment uses one collaboration process or document-aware sticky routing. The Redis
lease prevents conflicting writers on multiple instances but does not relay CRDT updates between
them. A process crash loses changes after the last acknowledged database snapshot; reconnect
restores persisted content after lease expiry. A distributed relay and durable per-update journal
can be added independently. The operational defaults keep collaboration disabled until its
private listener and same-origin proxy are configured. WebSocket activity does not extend the
BFF session lifetime; expired sessions reconnect through the normal login flow.
