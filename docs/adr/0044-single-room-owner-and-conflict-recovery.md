# ADR 0044 — Collaboration room ownership and durable conflict recovery

Status: Accepted · 2026-10-06 · M-14

A Hocuspocus room is an in-process Yjs document. Redis leases fence competing owners, but do not replicate that document. Randomly balancing room REST requests and WebSockets across API replicas therefore issues tickets on the wrong owner and can make a flush incorrectly report an absent room.

The supported deployment uses one dedicated collaboration owner, independent of the API replica count. Compose and Helm route both `/collaboration` and `/api/v1/scripts/:id/versions/:number/collaboration/*` to that owner. The public proxy strips certificate-proof headers on both paths. Helm continues to reject collaboration replicas other than one, autoscaling, and overlapping rolling updates. Ticket, flush and recovery reads preserve the authenticated BFF, Origin, CSRF and authorization boundaries. Ordinary API pods have their collaboration listener disabled. The dedicated service is the sticky destination; this decision does not support concurrent room owners or claim horizontal room scaling.

When a REST update or lifecycle transition advances a draft during the debounce window, the owner saves the complete Yjs state into an append-only, tenant-scoped `collaboration_conflicts` row before freezing the room. The preservation audit event and copy commit in the same transaction. A successful commit is required before the recovery ID is broadcast. The conflicting newer draft is never overwritten or acknowledged. Copies survive a process restart and can be listed/read only with update permission for the corresponding script. Forced PostgreSQL RLS isolates the bytes; the app role has only SELECT/INSERT.

Designer can inspect a preserved copy while normal edits remain suspended, then explicitly create a new authorized draft. Creation uses the existing document validation, audit and idempotency gates. Recovery leaves the original version untouched. Invalid or unauthorized copies remain preserved even if creating a draft fails.

This closes external-version conflict loss after a successful preservation commit. A hard process kill before the debounce write or an unavailable database can still lose unacknowledged edits; acknowledged writes retain the existing persisted snapshot fence. Operators back up recovery rows alongside authoring data. Automatic deletion is deliberately absent; retention is an operator decision consistent with tenant data policy.

Scaling beyond one owner requires room-key affinity for both REST and WebSocket paths, coordinated ownership migration, and a replicated Yjs update log/pub-sub extension. Adding pod replicas alone is forbidden. Validate that design under owner termination and cross-owner flush before removing the Helm guard.

Verification: collaboration snapshot fence unit regression decodes preserved Yjs bytes; real PostgreSQL recovery endpoints check restart-independent retrieval, other-tenant denial and unchanged drafts; migration drift/RLS catalogue; proxy configuration regression.
