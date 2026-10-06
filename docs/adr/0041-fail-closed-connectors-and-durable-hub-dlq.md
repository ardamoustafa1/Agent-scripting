# ADR-0041: Fail-closed connector activation, sidecar source and durable hub DLQ

Status: Accepted (2026-10-06). Refines ADR-0008, ADR-0019 and ADR-0020. These are breaking
deployment changes: a sidecar without `SIDECAR_SOURCE` no longer starts; a production hub needs
`HUB_DLQ_NATS_URL`; marketplace adapters are off unless an operator enables them.

## Context

The audit (M-24, T-01, T-07, T-08, T-10) found three fail-open paths:

- **Marketplace adapters.** Eight adapters (Amazon Connect, Cisco Webex/Finesse, NICE CXone,
  Five9, Twilio Flex, Salesforce, Dynamics 365) relay only the envelopes of an external vendor
  bridge that this repository does not ship. MATRIX.md still advertised their capabilities.
- **Sidecar source.** Both Java sidecars defaulted `SIDECAR_SOURCE` to `replay`. The Avaya
  sidecar also mapped *any* unknown value to replay. Health stayed UP, so production could
  silently run on recorded events.
- **Hub dead letters.** Events that could not be delivered were only logged. Queued events were
  also lost when the hub restarted.

## Decision

1. **Marketplace adapters.** They are created only when `HUB_MARKETPLACE_BRIDGE_ENABLED=true`
   (default `false`). An adapter that is not created is reported `down` with a reason instead of
   staying silently unknown. MATRIX.md lists them under "needs a vendor bridge" and claims no
   write-back, wrap-up or recording control until a real bridge passes a vendor-sandbox
   contract test. We did not write vendor SDK integrations, because they could not be verified
   without a sandbox.
2. **Sidecar source.** `SourcePolicy` requires an explicit platform source (`aes`/`aacc` or
   `psdk`) and rejects unknown values at startup. `replay` is accepted only together with
   `SIDECAR_ALLOW_REPLAY=true`. Health reports the active `source`.
3. **Durable hub DLQ.** Dead letters go to the JetStream stream `VERBIS_HUB_DLQ` with these
   settings: work-queue retention, file storage, `deny_delete`/`deny_purge`, a 2-minute
   duplicate window and a bounded max age. A record is dead-lettered in three cases: the API
   rejected it, its retries were exhausted, or it was still queued at shutdown (after the
   bounded drain). The subject is
   `verbis.connector.event.deadlettered.v1.<tenantId>.<connectorId>`. Replay is tenant-scoped
   (`POST /internal/v1/dead-letters/replay`, tenant taken from the verified API token). A record
   is acked only after the pipeline accepts it; on backpressure it is nak'ed and kept.
   Production requires `HUB_DLQ_NATS_URL`; dev/test fall back to a bounded in-memory store. The
   metric `verbis.connector.event.deadlettered{reason,outcome}` drives the
   `ConnectorEventDeadLettered` and `ConnectorDeadLetterLost` alerts.
4. **Genesys Cloud sandbox contract test.** An opt-in test (`GENESYS_SANDBOX=1`) validates live
   Platform API responses with the connector's own zod schemas.

## Consequences

- Deployments must set `SIDECAR_SOURCE` and, in production, `HUB_DLQ_NATS_URL`. Tenants that
  use marketplace connectors must deploy a bridge and set the flag explicitly.
- DLQ records contain the event payload, which can include PII, because replay needs it. The
  payload stays inside the platform's NATS (encryption at rest is a deployment concern), is
  bounded by max age, and is never logged. Logs and metrics carry only ids and bounded labels.
- An operator-facing replay UI and the API-side audit event (`connector.deadletter.replayed`)
  are follow-ups. The hub endpoint is internal and does not audit by itself.
