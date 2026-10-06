# ADR-0018: Connector SDK, connector-hub runtime and the hub ↔ API bridge

- **Status:** Accepted · 2026-10-01
- **Amends:** ADR-0008 (concrete connector contract; replaces the step-1 `ConnectorAdapter` placeholder — breaking for `@verbis/sdk-connector`)
- **Related:** [ADR-0017](0017-secure-launch.md), [SECURITY §4](../SECURITY.md), PROGRESS step 18

## Decision

### `@verbis/sdk-connector`
- `Connector` = `capabilities` (channels: voice, chat, email, sms, whatsapp, social, video,
  callback; features: writeBack, wrapUpCodes, recordingControl, transferContext; per-channel
  `maxConcurrent`), lifecycle `init / health / shutdown`, commands `writeAttributes / setWrapUp /
  pauseRecording / resumeRecording` (unsupported ⇒ `CommandNotSupportedError`, `commandId`
  deduplicated), `verifyParticipant(platformUserId, platformInteractionId)`.
- Events leave through `ctx.emit` as normalized `InteractionEvent`s: `interactionOffered,
  connected, held, resumed, transferred, ended, wrapupRequired`, with `eventId` (idempotency),
  platform user refs, campaign ref, flat attributes, transfer context and a discriminated
  `ChannelContext` (chat transcript, email subject/body/attachments, social post, …).
- **Mapper layer:** `defineMapper({ payloadSchema, map })` + `mapPlatformEvent` — raw platform
  payloads are zod-validated before mapping and the normalized result is validated again.
- `toScriptVariables(context)` → flat `channel.*` variables (e.g. `channel.email.subject`,
  `channel.chat.lastCustomerMessage`); the API stores them in the sealed interaction attributes.
- `emit` rejects with `BackpressureError` when the hub queue is full; connectors must push back.
- `signWebhook/verifyWebhook`: `X-Verbis-Signature: t=…,v1=<hmac-sha256("t.body")>`, multiple
  `v1` for rotation, 300 s tolerance.
- **Contract kit** (`@verbis/sdk-connector/testing`, `runConnectorContract`): capabilities and
  config, lifecycle, fixture → normalized events, invalid payload rejection, idempotent
  redelivery, backpressure propagation, feature-gated commands with `commandId` dedupe,
  participant verification (live / stranger / unknown / ended), no secret leakage. Every
  connector is required to pass it with recorded payloads in `fixtures/*.json` — no platform access needed.

### `apps/connector-hub`
- `ConnectorSupervisor`: loads the tenant's active connectors from the API (per-tenant mTLS
  service client), starts them by `adapterType` + `config.kind`, init retry with jittered
  backoff, periodic health with change reports, reconnect on `down`, config refresh, graceful
  shutdown. Secrets come from the integration vault via the API (`config.secrets` maps local
  names to Secret ids bound in `secret_refs`), cached ≤ 5 min in memory, never logged.
- `DeliveryQueue`: bounded (backpressure), ordered per interaction, parallel across interactions,
  retry with backoff, dead-letter callback.
- `EventPipeline`: event → `POST /v1/connector-hub/connectors/:id/events` (Idempotency-Key =
  eventId) → on `connected`, one `POST /v1/launch-intents` per (interaction, agent). An agent
  with 3 chats + 1 email gets four independent script sessions; a transfer launches a fresh
  session for the receiving agent. `AgentWorkload` tracks per-channel load.
- Connectors: **Generic Webhook** (`POST /webhooks/:connectorId`, HMAC over the raw body,
  signed write-back to an https `callbackUrl`) and **Simulator** (dev/demo; full lifecycle,
  rich channel context, capacity limits, command log; disabled in production).
- API → hub: `/internal/v1/*`, EdDSA token signed with the API's `INTERNAL_JWT_SIGNING_JWK`
  (aud `verbis-connector-hub`, ≤ 60 s, tenant from `tnt`). Used for participant verification
  (secure launch fallback verifier), runtime commands and the simulator proxy.

### API side
- `/v1/connector-hub/connectors[/:id/secrets|/health|/events]`: certificate-bound service only.
  Events are written synchronously through the same `RuntimeInteractionsHandler` logic (sealed
  PII), so a launch intent can follow immediately; `connector.event.received` is audited.
- **User mapping:** CTI identity for the connector's platform (`users.cti_identities`, set by
  admins or SCIM extension `urn:verbis:params:scim:schemas:extension:cti:2.0:User`) → IdP
  externalId → email; ambiguity maps to nobody.
- `/v1/simulator/connectors/:id/*` (`manage:Connector`, `SIMULATOR_ENABLED`, never production)
  forwards to the hub; admin-web "Interaction Simulator" uses it.

## Consequences
- Platform adapters (steps 19–22) implement `Connector`, add a mapper + fixtures, register in
  `connectors/registry.ts` and must pass `runConnectorContract`.
- The dead-letter sink is in-process (logged); a persistent DLQ (NATS) is a follow-up.
