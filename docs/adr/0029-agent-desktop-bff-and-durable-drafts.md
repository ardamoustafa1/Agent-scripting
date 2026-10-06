# ADR-0029: Agent desktop bootstrap and encrypted drafts

Status: accepted. Date: 2026-10-03.

The agent workspace needs immutable script rendering and integrations while preserving secure
launch, server writer fencing, tenant checks and secrets. Designer preview cannot establish an
agent session or safely proxy integration credentials.

Add owner-only `GET /v1/sessions/:id/desktop` with audited context access, pinned decoded document,
campaign dispositions, state and actual connector audit acknowledgement. Supervisors continue to
use masked observation endpoints. Add writer-fenced `POST /v1/sessions/:id/desktop/data-source`;
the server resolves an exact document source/version and invokes the same authorized integration
engine. Existing token-based callers retain their JWT validation; the BFF bridge uses a verified
user/BFF principal and repeats integration scope/session/version checks. Secrets stay server-side.

Each tab has an independent runtime and memory-only capability. Runtime resume establishes the
cursor without replaying entry actions. Host navigation guards flush fields before navigation; a pageChange port persists bounded, validated
back-stack history before page entry effects;
locale changes update renderer subscriptions without reconstructing the writer. Normalized platform
hold/resume/transfer/disconnect controls pause/wrap-up/terminal states and revokes obsolete leases.

Encrypted IndexedDB drafts use AES-GCM with non-extractable browser keys and scoped AAD. They never
contain PCI values or credentials. Transactions must commit before saves are considered durable;
version conflicts require an explicit agent choice and incompatible script drafts remain retained.
No API/schema version is broken. Reconnection uses fresh one-use socket tickets and authoritative
HTTP snapshots. See AGENT_DESKTOP.md for browser storage/SSO/cold-start limitations and acceptance.
