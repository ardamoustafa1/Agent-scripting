# ADR 0052 — Live agent AI: intent suggestions, notice detection and wrap-up summary

Status: Proposed · 2026-10-07 · DIFFERENTIATORS E4, E5, E6, D5 (reply/objection/summary suggestions exist per ADR-0032; transcript streaming, navigation suggestions and PII reveal do not)

## Context

ADR-0032 provides tenant opt-in, a local PII recognizer gate, quotas, human approval and
provider adapters; the agent panel can request `reply`, `objection` and `summary` suggestions on
demand. Live help while the customer is on the line additionally needs a transcript stream, a
latency budget and clear limits on what the model may do.

## Proposal

1. **Intent → page suggestion (E4)**: a provider-independent `TranscriptSource` port feeds short
   windows (last N turns) through the existing PII gate; the model returns a constrained choice
   among the pinned script's page ids (enum, never free navigation). The agent sees "Go to
   <page>?" and nothing moves without a click. Budget: suggestion within 1.5 s p95 or it is
   dropped silently (no spinner that blocks the script).
2. **Notice detection (E5)**: compares the transcript with the D3 checklist items and marks a
   notice as *probably said*; it never ticks the confirmation. The agent confirmation stays the
   only state that satisfies the guard and the audit trail.
3. **Wrap-up summary and outcome suggestion (E6)**: from session events (+ transcript if the
   tenant enables it); output is a suggestion constrained to the campaign's outcome codes.
4. **Context card (D5)**: masked by default; "reveal" calls a new endpoint that checks the
   field-level `reveal` ability (ADR-0013) and writes an audit event per reveal.

## Decisions needed before implementation

- Transcript source per platform (Genesys Cloud has it; Engage/Avaya need a speech service),
  data residency of the provider for conversation audio/text, and retention (none by default).
- Per-tenant latency/availability SLO and the fallback when the provider is slow.
- Whether notice detection results may be used for QA scoring (works-council implications).

## Consequences

No change until accepted. D3's checklist and the existing on-demand suggestions remain the
supported capabilities.
