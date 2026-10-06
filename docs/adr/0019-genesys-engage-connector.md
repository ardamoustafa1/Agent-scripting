# ADR-0019: Genesys Engage connector — Workspace API sessions + Platform SDK sidecar

- Status: Accepted (2026-10-01)
- Amends: [ADR-0008](0008-adapter-based-connectors.md) (resolves OD-2 for Genesys Engage) · Stack exception to [CLAUDE.md §2](../../CLAUDE.md)
- Related: [ADR-0017](0017-secure-launch.md) (s2s launch), [ADR-0018](0018-connector-sdk-and-hub.md), [connectors/genesys-engage.md](../connectors/genesys-engage.md)

## Context

Genesys Engage (PureEngage, on-prem) has no tenant-wide event API comparable to Genesys Cloud.
Two integration surfaces exist, and **WDE is excluded** (ADR-0008):

1. **GWS / Workspace API v3** (REST + CometD). Every session belongs to *one signed-in user*
   (`/api/v2/me/*`, `/workspace/v3/*`), so a server cannot follow all agents with one service
   account.
2. **Platform SDK** (Java/.NET). It talks to T-Server, Interaction Server, Config Server and OCS
   directly. This is server-side and covers every agent DN, but it needs the licensed SDK jars and
   a JVM.

## Decision

One adapter `genesys_engage` with two `kind`s. Both produce the same neutral **Engage envelope
v1**, which a single mapper turns into `InteractionEvent`s.

- **`kind: workspace`**: connector-hub keeps **one Workspace API session per linked agent**.
  - The agent, already signed in to Verbis with SSO, links once per shift in a first-party popup.
    The flow is an Authorization Code grant at the Genesys Authentication Service, with a
    confidential client whose secret is in the vault.
  - The API keeps the refresh token sealed in Redis, with a TTL equal to the shift. Over the mTLS
    service client it vends short-lived access tokens to the hub (`/v1/connector-hub/connectors/:id/engage/*`).
  - Every token issuance is audited. Tokens never reach the browser.
  - The hub only initializes the session, subscribes and activates channels. It never sends
    agent-state requests.
- **`kind: sidecar`**: a new deployable, `apps/connector-genesys-engage-sidecar`
  (**Java 21 + Spring Boot**, Gradle, outside the pnpm workspace).
  - It uses the Platform SDK. It registers agent DNs on T-Server in `ModeShare`, connects to
    Interaction Server as `ReportingEngine` (plus a `Proxy` connection for write-back), and reads
    agent identity from Config Server.
  - It publishes envelopes to NATS JetStream on `verbis.connector.engage.<connectorId>.event.v1`
    with `Nats-Msg-Id = eventId`.
  - It answers commands and verification on core NATS request/reply (`…command.v1`, `…verify.v1`).
  - The hub consumes through a durable pull consumer with explicit ack. Backpressure is answered
    with `nak(1s)` (the message is redelivered); a poison message is answered with `term`.
- We chose NATS over gRPC because NATS JetStream is already the platform bus (ADR-0005), gives
  durable redelivery, and needs no new port or TLS PKI between the hub and the sidecar. Per-tenant
  NATS accounts and credentials scoped to `verbis.connector.engage.<connectorId>.>` isolate tenants.
- **Launch** is server-to-server (ADR-0017 a). On `connected` the pipeline creates a launch intent
  and pushes it to the agent's open Verbis `/launch` socket. Re-verification requires both:
  - the connector's authoritative event state, and
  - the live link: for `sidecar` the sidecar's own T-Server/Interaction Server state, for
    `workspace` that agent's own session being connected.
- **Data minimisation:**
  - Only admin-mapped attached-data keys become script variables
    (`PUT /v1/connectors/:id/attached-data-map`, If-Match, audited).
  - The sidecar can additionally allow-list keys at the source (`USER_DATA_ALLOW_LIST`).
  - Unmapped write-backs land under a `Verbis_` prefix and never overwrite foreign keys.
- **Outbound (OCS):**
  - The `GSW_*` record fields are exposed as `outbound.*`.
  - The disposition is written to the business-attribute key (default `DispositionCode`).
  - The call result is reported with the OCS desktop protocol
    (`GSW_AGENT_REQ_TYPE = RecordProcessed | UpdateCallCompletionStats`) as a T-Server UserEvent.

## Consequences

- **A second language in the repo.** Java code lives only in the sidecar, and it has its own CI
  job (Gradle + Testcontainers). The PSDK adapter (`src/psdk/java`) is compiled only when a
  licensed repository is supplied (`-Ppsdk.repo`). CI builds and tests the replay source, the
  NATS bridge and the contracts.
- **Two schemas to keep in sync.** The envelope contract exists in zod (hub, authoritative) and in
  JSON Schema (sidecar). Changing it means a new version (`…envelope.v2`) and a new subject version.
- **Workspace mode is only as live as the agents' links.** An unlinked agent gets no automatic
  scripts. agent-web shows a link card on the home screen.
- **No recording control.** T-Server/GWS have no pause API we can rely on; the GIR/MCP integration
  is a follow-up.

## Rejected

- WDE extension (ADR-0008).
- A GWS supervisor account monitoring all agents: there is no documented tenant-wide notification channel.
- gRPC between sidecar and hub: it would need extra PKI and a port, and offers no durable redelivery.
- Storing agent passwords for the password grant: forbidden.
