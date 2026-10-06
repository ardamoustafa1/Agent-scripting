# ADR-0020: Avaya connectors — one Java sidecar for Aura AES / AACC, native AXP adapter

- Status: Accepted (2026-10-01)
- Amends: [ADR-0008](0008-adapter-based-connectors.md) · Builds on [ADR-0019](0019-genesys-engage-connector.md) (Java sidecar + NATS pattern)
- Related: [ADR-0017](0017-secure-launch.md), [connectors/avaya.md](../connectors/avaya.md)

## Context

The three Avaya platforms expose different interfaces:

| Platform | Interfaces |
|---|---|
| **Aura + AES** | JTAPI/TSAPI, DMCC (Java/.NET SDKs, licensed, not on Maven Central) |
| **AACC / CC Elite** | CCT Open Interfaces (WS-Notification push), CCMM web services (SOAP) |
| **AXP** (CCaaS) | OAuth2 REST, Notification API WebSocket, Workspaces Widget Framework |

Outbound runs on POM or Proactive Contact. Neither the switch nor AXP offers a recording pause we
can rely on.

## Decision

1. **Aura AES and AACC run through one Java 21 sidecar,** `apps/connector-avaya-aes-sidecar`. One
   process serves one connector, and `SIDECAR_SOURCE` is `aes` or `aacc`. The sidecar publishes
   **Avaya envelope v1** on NATS JetStream (`verbis.connector.avaya.<id>.event.v1`) and handles
   commands and verify on request/reply. This is the same transport as Engage: the hub's
   `shared/nats-sidecar-transport.ts` is reused.
   - **AES:** JTAPI call observers on agent stations (plus optional VDNs). The adapter only
     observes: no call control and no agent-state requests. The JTAPI module compiles only with
     `-Pavaya.jtapi=<ecsjtapia.jar>`. DMCC is not used: the events we need (delivered,
     established, held, transferred, cleared, plus UCID, UUI, VDN and split) are available
     through JTAPI without registering devices.
   - **AACC:** CCT pushes WS-Notification to a token-protected endpoint on the sidecar.
     - The XML parser is hardened (no DTDs, no external entities).
     - CCMM SOAP enriches contacts (email and chat text), updates intrinsics, and closes contacts
       with a closed reason, which is the disposition.
2. **AXP is a hub-native adapter** (`avaya_axp`, kind `workspaces`). It needs no sidecar.
   - Auth: Client Credentials at the account realm plus the `appkey` header. Hosts are pinned to
     `*.api.avayacloud.com` / `*.cc.avayacloud.com`.
   - Events: Notification API WebSocket, family `AGENT_ENGAGEMENT`.
   - Wrap-up: the Interactions API with a disposition code.
   - Launch: a **Workspaces custom widget** frames agent-web `/launch#connector=…&conversation=<id>`.
     This is the embedded flow (ADR-0017 b): the API asks the hub, and the hub reads the
     engagement with the connector's own credentials.
3. **Outbound:**
   - POM and PC records are recognised from data the dialer attaches to the call (UUI kv keys or
     intrinsics); field names are configurable.
   - Record fields become `outbound.*` variables.
   - The result is reported through POM web services or the PC Agent API (application logon), as
     an `outboundResult` command.
4. **Secure pause through the recording system.** A shared `RecordingHook` POSTs a signed,
   idempotent command (`pause` | `resume` | `tag`) to the recorder integration, keyed by UCID.
   Aura inbound calls have no switch-side disposition store, so their wrap-up *tags* the recording.
5. **Routing:**
   - VDN and skill (Aura), skillset (AACC), queue (AXP) and outbound campaign are bound in campaign
     external mappings. Order: outbound › VDN › skill.
   - Agents are matched through CTI identities: login id (Aura), agent handle (AACC), login id (AXP).

## Consequences

- One more JVM service and one more CI job. The JTAPI code is compiled only where the SDK is
  licensed.
- **AES cannot write data into a live call,** so `writeBack` is not declared for `avaya_aes`.
  UUI is set by the call's originator (IVR/routing).
- **AXP write-back is not declared.** The Context Store integration is a follow-up.
- **Recorder integrations differ per vendor.** The hook contract is small and documented, so an
  adapter in front of a given recorder is cheap.

## Rejected

- **DMCC device registration for monitoring.** It consumes DMCC licences and needs device
  ownership, and adds nothing for observation.
- **A TSAPI C library through JNI.**
- **A .NET sidecar for CCT.** The SOAP and WS-Notification interfaces are language-neutral.
- **Calling AXP from agent-web directly.** That would put tokens in the browser.
