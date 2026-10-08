# ADR 0052 — Live agent AI: intent suggestions, notice detection and wrap-up summary

Status: Partly accepted (E4 on-demand navigation suggestion implemented) · Proposed for the rest · 2026-10-07 · DIFFERENTIATORS E4, E5, E6, D5 (reply/objection/summary suggestions exist per ADR-0032; transcript streaming, navigation suggestions and PII reveal do not)

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

## Decision (2026-10-07): on-demand navigation suggestion implemented

The part that needs no transcript stream and no new provider decision is built:

- New AI task `navigate` on the existing ADR-0032 path (SSO user, tenant opt-in and
  `agentEnabled`, local PII redaction, quota reservation, audit, human approval). It is available
  for chat and e-mail interactions while the session is `active`/`paused`.
- The model sees `pageChoices` (`{id, name}` of every page of the **pinned** script version
  except the one shown) and must answer `{ pageId | null, reason }`. The service rejects any
  `pageId` that is not in that list, so a suggestion can never point outside the script.
- The agent panel offers "Suggest next page"; accepting calls `runtime.navigate(pageId)`, which
  keeps the runtime's required-field and rule checks. Nothing moves without a click.

Still open and unchanged: live transcript stream with the 1.5 s p95 budget (and the speech
service for voice platforms), E5 notice detection, D5 PII reveal.

### Also implemented: on-demand notice detection (E5)

- AI task `notices`: the model receives `noticeChoices` (`{id, title, text}` of every `mustRead`
  notice of the pinned script, wording in the request locale, bounded) and answers
  `{ noticeIds, reason }`; the service rejects any id outside that list.
- The agent panel's "Mark as probably said" stores the ids in the controller only
  (`probablySaid`, not persisted); the checklist shows "Probably said (AI), please confirm" next to
  a still-pending notice. The runtime acknowledgement (`runtime.read.<id>`), the server guard and
  the audit trail are untouched: only the agent's confirmation satisfies them.
