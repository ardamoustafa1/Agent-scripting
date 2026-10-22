# ADR 0052 — Live agent AI: intent suggestions, notice detection and wrap-up summary

Status: Accepted for the live transcript stream and script triggers (2026-10-22, see the last
section; the product owner asked to settle the open decisions and implement) · E4/E5 on-demand
suggestions accepted 2026-10-07 · D5 PII reveal still Proposed · DIFFERENTIATORS E4, E5, E6, D5

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

(Answered on 2026-10-22 in "Decision (2026-10-22)" below; kept as the original question list.)

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

## Decision (2026-10-22): live transcript stream and script triggers

The product owner asked to settle the open decisions above and build the live part. Decided:

### 1. Source: text segments, never audio

- Verbis does not receive, store or recognize audio. Speech recognition, its data residency and
  its licence stay with the contact-center platform or the customer's own speech service
  (e.g. platform transcription, or a speech service that posts to the generic webhook).
- A connector that declares the new `liveTranscript` feature hands text to the hub with
  `ctx.emitTranscript(segment)`. `TranscriptSegment` (`@verbis/sdk-connector`): `segmentId`,
  `platformInteractionId`, `speaker` (`customer` | `agent`), `text` (1–2,000 characters),
  `final`, `occurredAt` and an optional `language`. Bot and system lines are not segments.
- Built now: the simulator (`utterance` action in the admin simulator) and the generic webhook
  (`type: "transcript.segment"`, the same HMAC signature as lifecycle events). Platform
  transcription (Genesys Cloud `v2.conversations.{id}.transcription`, Amazon Connect Contact
  Lens, Engage/Avaya through a speech service) is a follow-up per connector; connectors that do
  not declare the feature are unaffected. Chat lines already reach the script through the channel
  context and are not converted into segments by this decision.
- The hub delivers segments through its own bounded queue, ordered per interaction, to
  `POST /v1/connector-hub/connectors/{id}/transcript-segments`. Speech is ephemeral: a rejected
  or exhausted segment is dropped with a metric and an id-only log and is never dead-lettered
  with its text.

### 2. Retention, access and opt-in

- Tenant opt-in `settings.liveTranscript.enabled`, default off, changed by a tenant
  administrator through the existing audited settings update. When it is off, the API
  acknowledges segments with `accepted: false` and discards them.
- Before a line is stored, pushed or evaluated, a run of 13+ digits holding a Luhn-valid card
  number keeps only its last four (PCI-DSS req. 3). Digits a recognizer writes as words are not
  caught, so payment steps pause transcription on the platform (SECURITY §6.5).
- Text lives only in Redis, sealed with the tenant keyring (AAD
  `runtime:transcript:<tenant>:<interaction>`): final segments only, at most 200 per
  interaction, expiring 60 minutes after the last segment and deleted when the interaction ends.
  It never reaches PostgreSQL, the audit trail, the outbox/NATS, analytics or logs.
- The API pushes each segment (interim ones too) as `runtime.transcript` to an owner-only
  Socket.IO room `runtime:<tenant>:<session>:owner`; supervisor sockets do not join it, so the
  masked supervisor view is unchanged. `GET /v1/sessions/{id}/desktop/transcript` returns the
  stored window to the session owner after a reload and is audited as
  `runtime.transcript.viewed`.
- The first accepted segment of an interaction is audited as `runtime.transcript.started`
  (connector actor, interaction target, no text).

### 3. Script triggers: deterministic phrase rules, not a model call

- New optional top-level `triggers` section of the script document (additive, no
  `schemaVersion` bump, as `testScenarios` before it). A trigger has a stable kebab-case id, a
  name, phrases per locale, a speaker (`customer` by default, `agent` or `any`), an optional page
  scope, a repeat rule (`once` per session by default, or a cooldown of 10–3,600 seconds) and one
  to three actions:
  - `suggestPage` (`pageId`): the agent sees "Go to <page>?"; nothing moves without a click, and
    accepting goes through `runtime.navigate`, so required fields and rules still apply;
  - `alert` (`messageKey`, `tone`): a localized hint card;
  - `markNotice` (`noticeId` of a `mustRead` node): "probably said" next to the pending notice.
    It never acknowledges; the server guard and the audit trail still require the agent's
    confirmation.
- Matching (`matchPhrase` in `@verbis/script-schema`, shared by the API and the designer's test
  box): text is folded Turkish-aware (Turkish lower-casing, diacritics removed, `ı` → `i`) and
  split into words; the words of a phrase must appear consecutively and each one matches a word
  that starts with it, so "iptal" matches "iptalini". Phrase words shorter than three letters
  must match whole words. Only final segments are evaluated, against the session's pinned script
  version, its current page and the session's earlier hits.
- A suggested page must be a page step of the main flow (`TRIGGER_PAGE_NOT_IN_FLOW` otherwise):
  the runtime can only move along the main flow. Building this showed that `Runtime.navigate`
  checked the flow position after persisting the move; it now fails before any side effect.
- A hit is the session event `transcript.triggered` with `{ triggerId, speaker, segmentId }`
  (audit `runtime.session.transcripttriggered`; the analytics outbox carries the event type
  only), never the text. The agent resolves it with
  `POST /v1/sessions/{id}/desktop/prompts/{triggerId}` (`accepted` | `dismissed`), recorded as
  `prompt.resolved`. The desktop response lists pending prompts (hit and not yet resolved; a page
  suggestion is hidden while that page is shown). A re-delivered segment never fires twice.
- Latency: no provider call is involved. Budget: 1.5 s p95 from API receipt to the agent push,
  measured with the span `runtime.transcript.ingest`. When the realtime channel is down, prompts
  appear at the next desktop refresh; nothing blocks the script.
- Limits: 100 triggers per script, 20 phrases per locale, 80 characters per phrase, 3 actions.
- The designer gets a Triggers editor mode with a "try a sentence" box using the same matcher,
  and health checks for unknown pages, notices or messages and for triggers without phrases.

### 4. Voice transcript for the on-demand AI tasks

When both agent AI (ADR-0032) and live transcript are enabled, the `navigate`, `notices` and
`summary` tasks may read the stored transcript window of a voice session, through the same PII
gate, quota, audit and human approval as chat and e-mail.

### 5. Quality scoring

Trigger hits and "probably said" hints are not used for per-agent quality or adherence scoring.
Analytics may count hits per script and trigger, never per agent. Scoring needs its own ADR
(works-council review).

### Consequences

- Additive for every contract: script documents without `triggers`, connectors without the
  feature and tenants that stay opted out behave as before; no API or schema version bump.
- Security-critical coverage: owner-only delivery (supervisor and other users refused), opt-out
  discards, sealing and expiry, no text in audit/outbox/logs, idempotent hits, page and notice
  references constrained to the pinned version.
- Still open: per-platform transcription sources, chat-to-segment conversion, D5 PII reveal.
