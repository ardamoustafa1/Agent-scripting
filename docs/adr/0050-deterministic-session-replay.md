# ADR 0050 — Deterministic session replay (record/replay)

Status: Proposed · 2026-10-07 · DIFFERENTIATORS B2 (not implemented; needs a decision on retention and redaction classes)

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
