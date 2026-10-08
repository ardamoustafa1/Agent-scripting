# ADR 0050 — Deterministic session replay (record/replay)

Status: Accepted for the metadata-only option (path replay) · Proposed for faithful record/replay · 2026-10-07 · DIFFERENTIATORS B2

## Context

A designer should open a problematic production session in the debugger and watch it replay
against the same script version. Today analytics facts are metadata only (ADR-0031) and the
preview debugger runs against mock data sources. Replaying faithfully needs the inputs the
session saw, which is exactly the data we deliberately do not keep.

## Proposal

1. **Record only what a replay needs, redacted at write time.** Per session: script version
   checksum, the ordered agent inputs (field id → value) and data-source responses (id → body)
   after the same redaction the audit trail uses (`pii`/`pci`/`secret` classification drives it;
   `pci` is never stored, `pii` only as a salted token that preserves equality, not content).
2. **Replay uses recorded I/O, never the network.** Data sources are served from the recording,
   timers run on a virtual clock, ids and randomness come from the injected generators (already a
   project rule). A replay that needs an unrecorded response stops with an explicit gap.
3. **Access is a sensitive read.** New permission `replay:Session`, tenant opt-in, per-session
   audit event, and a visible watermark in the debugger. Recordings are tenant-scoped under RLS
   and encrypted with the tenant data key.
4. **Retention** defaults to 14 days and is capped by the tenant's analytics retention and legal
   hold; erasure requests (ADR-0030) delete recordings with the session.

## Decisions needed before implementation

- Whether salted-token PII is acceptable to the customer's DPO or recordings must be metadata-only
  with synthetic values (then replay shows structure and timing, not content).
- Storage cost ceiling (a 40-step session with 5 data-source bodies is typically 50–200 KB).
- Whether supervisors, not only designers, may open replays.

## Consequences

No change until accepted. Until then the closest capability is B3: replaying saved synthetic
scenarios and generating scenarios for untested branches.

## Decision (2026-10-07): metadata-only path replay implemented

The DPO question is answered conservatively: **no new data is recorded**. The runtime already
keeps an append-only event log per session (`page.entered`, `field.changed` with values
redacted by variable classification, `session.transitioned`, `timer.started`, outcome). The
replay is built from exactly those events over the session's pinned script version:

- `GET /v1/sessions/:id/replay` returns the ordered steps, per-page visits and dwell time, the
  pages of the pinned version the session never reached, and a `truncated` flag (5,000 events).
  Values are copied only for `field.changed` (already `[REDACTED]` unless the variable is
  persisted and not PII/PCI); structures collapse to `[…]`, and nothing at all is copied from
  event types the replay does not know (e.g. outcome notes).
- **Access** needs `read` on the session (the existing ABAC rules, so supervisors see only their
  teams) plus `read` on the script in the designer; every view writes
  `runtime.session.replayViewed`. No new permission or tenant opt-in was added: tenants grant
  `session.read` to designer roles through custom roles.
- The designer shows it on `/scripts/:id/versions/:number/replay` with a watermark that says
  the view is metadata only and audited.
- `GET /v1/sessions` gained a `scriptVersionId` filter.

Faithful record/replay (recorded data-source responses, virtual clock, re-execution in the
debugger) is **not** built and still needs the retention and salted-token decisions above.
