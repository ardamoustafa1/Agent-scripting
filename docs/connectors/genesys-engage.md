# Genesys Engage (PureEngage, on-prem) connector

Related: [ADR-0019](../adr/0019-genesys-engage-connector.md) · [ADR-0008](../adr/0008-adapter-based-connectors.md) (no WDE) · [ADR-0017](../adr/0017-secure-launch.md) (s2s launch) · [PROGRESS step 20](../PROGRESS.md)

Code:
- hub: `apps/connector-hub/src/connectors/genesys-engage/`
  - `envelope.ts` (the contract)
  - `mapper.ts`
  - `workspace/*`
  - `../shared/nats-sidecar-transport.ts` (NATS link, shared with Avaya)
- sidecar: `apps/connector-genesys-engage-sidecar/` (Java 21, Spring Boot)
- API:
  - `apps/api/src/modules/connectors/genesys-engage/` (agent link, hub tokens, attached-data map)
  - shared schema `packages/sdk-connector/src/platforms/genesys-engage.ts`
- UI:
  - agent-web `launch/engage-links*` (link card on the home screen)
  - admin-web `engage/attached-data-*`

## 1. Documentation check (2026-10-01) and assumptions

Sources checked:
- docs.genesys.com, Web Services API 8.5:
  - [UpdateUserData](https://docs.genesys.com/Documentation/HTCC/latest/API/UpdateUserData):
    `POST /api/v2/me/calls/{id}` with `{operationName:"UpdateUserData", userData}`, which causes a
    CometD `AttachedDataChanged` on `/v2/me/calls`.
  - [Asynchronous events](https://docs.genesys.com/Documentation/HTCC/8.5.2/API/AsynchronousEvents):
    CometD channels `/v2/me/calls`, `/v2/me/chats`, `/v2/me/emails`, `/v2/me/openmedia`, …,
    `/notifications/services`.
- Genesys Authentication API (`/auth/v3/oauth/token`: Authorization Code, client credentials via
  HTTP Basic).
- Workspace API search results (`/workspace/v3/voice`, `CallStateChanged`, `activate-channels`).

The PureEngage Developer Center pages (developer.genesys.com) now redirect and could not be read
automatically. **V** = verified in those sources, **A** = assumption. Verify every **A** in a lab
environment before go-live.

| # | Topic | What the code does | Conf. |
|---|---|---|---|
| 1 | Session scope | GWS/Workspace API sessions are per signed-in user (`/me`). There is no tenant-wide notification channel, so we hold one hub session per *linked* agent (ADR-0019). | V (`/me`), A (no supervisor stream) |
| 2 | Workspace auth | Genesys Authentication: `GET /auth/v3/oauth/authorize?response_type=code&client_id&redirect_uri&state`, then `POST /auth/v3/oauth/token` with `grant_type=authorization_code` / `refresh_token` and Basic `client:secret`. The token goes to Workspace as `Authorization: Bearer`. | V (token endpoint, Basic), A (authorize path, refresh grant) |
| 3 | Agent identity at link | `GET /auth/v3/userinfo` returns `employeeId` / `username` (`user_name`). Agent login ids are not available, so `agentIdentity=agentLoginId` cannot be linked in workspace mode. | A |
| 4 | Workspace session | Flow: `POST /workspace/v3/initialize-workspace` (session cookie), then CometD at `/workspace/v3/notifications` (handshake, subscribe, long-poll connect), then `POST /workspace/v3/activate-channels {data:{channels}}`. Channels: `/workspace/v3/initialization`, `/workspace/v3/voice`, `/workspace/v3/media`. A second session of the same user next to the agent's own desktop is allowed, and DN state is shared. | V (channel names, CallStateChanged), A (paths, multi-session) |
| 5 | Workspace events | `CallStateChanged.call.{id, connId, previousConnId, state ∈ Ringing\|Dialing\|Established\|Held\|Released\|Completed, callType, ani, dnis, userData[{key,type,value}]}`, `notificationType` (`StateChange`, `AttachedDataChanged`). `InteractionStateChanged.interaction.{id, mediatype, state ∈ Invite\|Accepted\|Processing\|Revoked\|Released\|Completed, queue, userData}`. `call.id` equals the ConnID. | V (message names), A (field/state names) |
| 6 | Workspace write-back | `POST /workspace/v3/voice/calls/{id}/update-user-data` and `POST /workspace/v3/media/{mediatype}/interactions/{id}/update-user-data`, both with `{data:{userData:[{key,type:'str'\|'int',value}]}}`. OCS feedback goes through `POST /workspace/v3/voice/send-user-event` with `{data:{userData, connId}}`. | A (GWS 8.5 equivalent is V) |
| 7 | T-Server (sidecar) | `RequestRegisterAddress(dn, ModeShare, RegisterDefault, DN)`. Events used: `EventRinging`, `EventDialing`, `EventEstablished`, `EventHeld`, `EventRetrieved`, `EventPartyChanged` (`PreviousConnID`, `ThirdPartyDN`), `EventReleased`, `EventAbandoned`, `EventAttachedDataChanged`, `EventAgentLogin`/`Logout`. Event id = `<T-Server app>:<EventSequenceNumber>`. Write-back: `RequestUpdateUserData(dn, connId, kv)`. | A (PSDK 8.5/9.0 API names) |
| 8 | Interaction Server (sidecar) | Client type `ReportingEngine` for lifecycle reporting events (`EventAgentInvited`, `EventPartyAdded`, `EventPartyRemoved`, `EventProcessingStopped`, `EventRevoked`, `EventPropertiesChanged`); `Proxy` for `RequestChangeProperties`. The agent id in party info is the employee id. | A |
| 9 | Config Server (sidecar) | Lookup: `CfgAgentLogin(loginCode)` → `CfgPerson(loginDbid)` → `employeeID`, `userName`. Interaction Server agents: `CfgPerson(employeeId)`. | A |
| 10 | OCS | Record fields arrive as attached data: `GSW_RECORD_HANDLE`, `GSW_CAMPAIGN_NAME`, `GSW_CALLING_LIST`, `GSW_APPLICATION_ID`, `GSW_CHAIN_ID`, `GSW_PHONE`, `GSW_ATTEMPTS`, plus custom `send_attribute` fields. The result is sent as a UserEvent with `GSW_AGENT_REQ_TYPE = RecordProcessed` (final) or `UpdateCallCompletionStats`, together with `GSW_RECORD_HANDLE`, `GSW_CALL_RESULT` (enum value configured per Verbis outcome) and `GSW_APPLICATION_ID` / `GSW_CAMPAIGN_NAME`. | A (desktop protocol, well established) |
| 11 | Disposition | Written as attached data to the business-attribute key `DispositionCode` (configurable), with the note under `Verbis_Note`. | A (deployment-specific key) |
| 12 | Rate limits | GWS answers 429/5xx: we wait for `Retry-After` (capped at 60 s), retry at most 4 times, and refresh the token once on 401. | A |

## 2. Architecture

```
            (a) workspace                                   (b) sidecar
agent ── SSO ── Verbis BFF ── link popup ── GAuth   T-Server / Ixn Server / Config Server / OCS
                   │ sealed refresh token (Redis)                │ Platform SDK (Java 21)
                   ▼ short-lived access token (mTLS)            ▼
connector-hub ── Workspace API v3 session per agent      sidecar ── NATS JetStream (events)
                   │ CometD long-poll                            │ request/reply (commands, verify)
                   └──────────── Engage envelope v1 ─────────────┘
                                       ▼
                      mapper → InteractionEvent → pipeline → API (upsert, s2s launch push)
```

- **Agent mapping.**
  - `agentIdentity ∈ employeeId | userName | agentLoginId` (default `employeeId`) chooses the
    platform user id that the hub emits.
  - The API maps it to the Verbis user through CTI identities (`platform: genesys_engage`); the
    workspace link writes that identity. Other sources are SCIM/admin, then `externalId`, then
    email (user-mapping.ts).
- **Launch** (ADR-0017 a, s2s): the agent keeps Verbis open with SSO. On `connected` the hub
  creates a launch intent (`delivery: push`) and the script opens by itself.
  `verifyParticipant` requires both the event state and the live link (§ADR-0019).

## 3. Installation guide

### (a) Workspace API mode
1. In Genesys Authentication, register a confidential OAuth client with:
   - the redirect URI `https://<agent-web origin>/api/v1/genesys-engage/oauth/callback`;
   - SSO federated to the same IdP as Verbis, so the link is a click and no password is typed.
2. Store the client secret in the Verbis vault and reference it as `secrets.authClientSecret`.
3. Create a connector with `adapterType: genesys_engage` and this config:
   ```json
   { "kind": "workspace", "baseUrl": "https://gws.example.internal", "authUrl": "https://gauth.example.internal",
     "authClientId": "verbis", "redirectUri": "https://acme.agent.example/api/v1/genesys-engage/oauth/callback",
     "channels": ["voice", "chat", "email"], "agentIdentity": "employeeId", "linkTtlHours": 12,
     "secrets": { "authClientSecret": "<secret uuid>" } }
   ```
4. Agents see a *Link Genesys Engage session* card on the agent-web home screen, once per shift.

### (b) Sidecar mode
1. Provision NATS: a JetStream stream `VERBIS_ENGAGE` on subjects `verbis.connector.engage.*.event.v1`
   (2-minute duplicate window, retention ≥ 1 day, replicas 3). Create one user per sidecar,
   allowed only `verbis.connector.engage.<connectorId>.>`.
2. Build the sidecar with the licensed PSDK:
   ```bash
   docker build --build-arg PSDK_REPO=<repo> -t verbis/engage-sidecar apps/connector-genesys-engage-sidecar
   ```
3. Run it next to the Genesys servers with these settings:
   - `VERBIS_CONNECTOR_ID`, `SIDECAR_SOURCE=psdk`, `NATS_SERVERS`, `NATS_CREDS_FILE`;
   - `TSERVER_*` and `TSERVER_DNS` (agent DNs);
   - `IXN_*`;
   - `CONFSERV_*` (password from `CONFSERV_PASSWORD_FILE`);
   - optionally `USER_DATA_ALLOW_LIST`.
   Create a Config Server application object `Verbis_Sidecar` of type ThirdPartyServer, with
   connections to T-Server and Interaction Server.
4. Create the connector in Verbis:
   ```json
   { "kind": "sidecar", "nats": { "servers": ["tls://nats.example.internal:4222"] } }
   ```
   Give the hub's NATS credentials as `secrets.natsCreds`.

### Both modes
- **admin-web › Genesys Engage attached data:** map attached-data keys to script variables
  (type, write-back, PII). Changes apply within the hub refresh interval.
- **Disposition and OCS:** set `disposition.codes` (Verbis outcome → Genesys disposition value)
  and `outbound.callResults` (Verbis outcome → `GSW_CALL_RESULT` value) in the connector config.

## 4. Events → normalized

| Envelope `event` | Source | Normalized |
|---|---|---|
| `ringing`, `dialing` | EventRinging / EventDialing / Workspace Ringing, Dialing / Ixn invite | `interactionOffered` (`dialing` ⇒ outbound) |
| `established` | EventEstablished / Established / Accepted, Processing | `connected` |
| `held` / `retrieved` | EventHeld / EventRetrieved (Workspace: Established after Held) | `held` / `resumed` |
| `partyChanged` | EventPartyChanged / Ixn transfer | `transferred` (`agent` = from, `transferTo` = to) |
| `released` | EventReleased / Ixn party removed | `wrapupRequired` (with `disposition.requireAfterCall`), else `ended` |
| `markedDone`, `abandoned` | MarkDone / ProcessingStopped / Revoked / Abandoned | `ended` |
| `attachedDataChanged` | — | ignored (no lifecycle change) |

Attributes:
- mapped attached-data variables;
- `outbound.<GSW_*>` fields;
- `engage.mediaType`, `engage.callType`.

`campaignRef` is `{kind: campaign, externalId: GSW_CAMPAIGN_NAME}` for OCS interactions, otherwise
`{kind: queue, externalId: <queue / VQ>}`. Bind it in campaign external mappings with platform
`genesys-engage`.

Media → channel: `voice`, `chat`/`webchat`/`workitem` → chat, `email`, `sms`, `whatsapp`,
`facebook`/`twitter` → social.

## 5. Write-back

| Command | Effect |
|---|---|
| `writeAttributes` | Updates attached data. Mapped variables with `writeBack: true` are written to their own key; everything else goes to `Verbis_<variable>`. |
| `setWrapUp` | Writes `DispositionCode` (mapped) and `Verbis_Note` (`[subCodes] note`). For OCS records it also sends RecordProcessed / UpdateCallCompletionStats with the mapped `GSW_CALL_RESULT`. |
| `pauseRecording` / `resumeRecording` | Not supported (`CommandNotSupportedError`); see follow-ups. |

Commands are deduplicated by `commandId` in the hub and again in the sidecar.

## 6. Tests

- **Hub:**
  - fixture scenarios under `apps/connector-hub/src/connectors/genesys-engage/fixtures/`:
    sidecar voice with hold/ACW, OCS outbound, Interaction Server chat transfer and email;
    Workspace voice and chat; invalid payloads. Each runs `runConnectorContract`.
  - connector, mapper and Workspace-session specs (fake GWS with CometD long-poll).
  - `shared/nats-sidecar-transport.int.spec.ts`: real NATS JetStream via Testcontainers. Covers durable
    consume, backpressure redelivery, producer dedupe, commands and verify.
- **API:** link/token specs (state replay, session binding, identity conflict, refresh rotation,
  revoked refresh drops the link, hub-only tokens) and an attached-data-map spec (If-Match, audit).
- **Sidecar:** `EnvelopeContractTest` (contract, allow-list, OCS user event, ownership) and
  `NatsBridgeIT` (Testcontainers NATS: JetStream dedupe, command dedupe, invalid command, verify).
- **UI:** agent-web `engage-links.spec.ts`, admin-web `attached-data-api.spec.ts`.

Run everything with `pnpm test:engage` (add `--typecheck` to type-check first).
