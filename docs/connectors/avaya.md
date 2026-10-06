# Avaya connectors: Aura AES, Aura Contact Center (AACC / CC Elite), Experience Platform (AXP)

Related: [ADR-0020](../adr/0020-avaya-connectors.md) · [ADR-0008](../adr/0008-adapter-based-connectors.md) · [ADR-0017](../adr/0017-secure-launch.md) · [PROGRESS step 21](../PROGRESS.md)

| Adapter (`adapterType` / `kind`) | Transport | Launch | Code |
|---|---|---|---|
| `avaya_aes` / `sidecar` | Java sidecar (JTAPI/TSAPI) → NATS | s2s (ADR-0017 a) | hub `connectors/avaya/`, `apps/connector-avaya-aes-sidecar` (`aes/`) |
| `avaya_aacc` / `sidecar` | Java sidecar (CCT WS-Notification + CCMM SOAP) → NATS | s2s | hub `connectors/avaya/`, sidecar `aacc/` |
| `avaya_axp` / `workspaces` | hub: OAuth2 REST + Notification WebSocket | embedded widget (ADR-0017 b) | hub `connectors/avaya/axp/`, `infra/avaya-axp/widget/` |

Shared pieces:
- `shared/nats-sidecar-transport.ts` (the same link as Genesys Engage);
- `shared/recording-hook.ts` (secure pause);
- admin-web *Avaya routing*;
- the outbound modules in the sidecar.

## 1. Documentation check (2026-10-01) and assumptions

Sources:
- AES JTAPI javadoc (support.avaya.com elmodocs):
  [LucentCallInfo](https://support.avaya.com/elmodocs2/AES/3.1.1/jtapi/com/avaya/jtapi/tsapi/LucentCallInfo.html)
  with `getUCID()` and `getUserToUserInfo()` on call events, and
  [UserToUserInfo](https://support.avaya.com/elmodocs2/AES/3.1.1/jtapi/com/avaya/jtapi/tsapi/UserToUserInfo.html).
- AXP developer portal:
  - [Authentication](https://developers.avayacloud.com/avaya-experience-platform/v0.0.1/docs/how-to-authenticate-with-ccaas-apis):
    `…/auth/realms/{accountId}/protocol/openid-connect/token`, client credentials, `expires_in: 900`.
  - [API migration notice](https://developers.avayacloud.com/avaya-experience-platform/v0.0.1/docs/v1beta-api-migration-notice):
    the new base is `HOST-REGION.api.avayacloud.com` and needs an app key header.
  - [Agent and Engagement Events](https://developers.avayacloud.com/avaya-experience-platform/docs/notification-agent-and-engagement):
    subscription `POST /api/notification/v1/accounts/{accountId}/subscriptions` with
    `family: AGENT_ENGAGEMENT` and `transport: WEBSOCKET`; authenticate with `{subscriptionId, token}`;
    `ping` every 30 s; the events and fields listed below.
  - [Workspaces Widget Framework](https://developers.avayacloud.com/avaya-experience-platform/v0.0.1/docs/workspaces-widget-framework-overview):
    `api.onDataEvent('onInteractionEvent', …)` with the interaction `id`; the widget API
    `wrapUpInteraction(id, {dispositionCode, notes})`.
- AACC: [DevConnect AACC interfaces](https://www.devconnectprogram.com/site/global/products_resources/avaya_aura_contact_center/interfaces/index.gsp)
  (CCT Open Interfaces, CCMM web services, WS-Notification push) and the
  [CCMM FAQ](https://avayadocs.developerprogram.org/site/global/products_resources/avaya_aura_contact_center/support/faq_ccmm/index.gsp)
  (`CloseContact`; at most 5 ASCII intrinsics for landing pads).

**V** = verified in those sources, **A** = assumption. Validate every **A** in a DevConnect lab
or the customer's lab before go-live.

### Aura AES (sidecar `aes`)
| # | Topic | What the code does | Conf. |
|---|---|---|---|
| A1 | Provider | `JtapiPeerFactory.getJtapiPeer("com.avaya.jtapi.tsapi.TsapiPeer")`, then `getProvider("<tlink>;login=…;passwd=…;servers=host:450")`. The tlink is `AVAYA#<switch>#CSTA-S#<aes>` (secure). | A |
| A2 | Events | A `CallControlCallObserver` on each agent station (and optionally each VDN). Mapping: `CallCtlConnAlertingEv` → delivered; `CallCtlConnEstablishedEv` → established; `CallCtlTermConnHeldEv` → held; `CallCtlTermConnTalkingEv` after a hold → retrieved; `CallCtlCallEv` with `CAUSE_TRANSFER` → transferred; `CallCtlConnDisconnectedEv` → cleared. | A (event classes exist in JTAPI 1.4) |
| A3 | Avaya data | `LucentV5CallInfo.getUCID()`, `LucentCallInfo.getUserToUserInfo().getBytes()`, `getCalledAddress()` (the VDN), `getDeliveringACDAddress()` (split/skill). | V (UCID, UUI), A (VDN/skill accessors) |
| A4 | UUI | At most 96 bytes on CM. ASCII is passed through; anything else is sent as hex. Formats: `raw`, `kv` (`k=v\|…`), and CM *shared UUI* (`id len data`, ids mapped via `uui.sharedIds`). | A |
| A5 | Agent | `AgentTerminal.getAgents()[].getAgentID()` gives the ACD login id. Login id is the default identity because hot-desking makes extensions unstable. | A |
| A6 | ACW | AES reports no ACW on clear, so `afterCallWork` is false unless agent work-mode events are added (follow-up). The adapter therefore ends voice calls on clear and wrap-up is sent after the fact. | A |

### AACC (sidecar `aacc`)
| # | Topic | What the code does | Conf. |
|---|---|---|---|
| C1 | CCMM | SOAP 1.1 on `…/ccmmwebservices/`. `CIUtilityWs.GetSessionKey(userName, password)`; `CIContactWs.GetContactByID` (email `From/Subject/Text`, chat `CIContactAction[]`), `UpdateContactIntrinsics`, `CloseContact(contactID, closedReasonCode, closingNote)`. Namespace: `http://webservices.ci.ccmm.applications.nortel.com`. | V (CloseContact, WS existence), A (operation names, fields) |
| C2 | CCT push | WS-Notification `Notify/NotificationMessage/Message/ContactEvent` with `EventType ∈ {ContactPresented, ContactAccepted, ContactHeld, ContactRetrieved, ContactTransferred, ContactReleased, ContactClosed, IntrinsicsChanged}`, `ContactID`, `ContactType`, `Agent{AgentID, UserID, Extension}`, `TransferTo`, `Skillset`, `CDN`, `ANI`, `DNIS`, `UCID`, `Intrinsic{Key,Value}`, `SequenceNumber`, `AfterCallWork`. The subscription carries our `X-Verbis-Notify-Token` header. | V (WS-Notification), A (message shape) |
| C3 | Voice disposition | Voice contacts also use the closed reason. CCT activity codes are a follow-up. | A |

### AXP (hub, kind `workspaces`)
| # | Topic | What the code does | Conf. |
|---|---|---|---|
| X1 | Auth | Client credentials at `https://<host>/auth/realms/<accountId>/protocol/openid-connect/token`, with `client_id`/`client_secret` in the form body. API calls send `Authorization: Bearer` and `appkey: <key>`. | V |
| X2 | Events | `body.event` and `body.action`. Mapping: `MatchOffered` / `AgentParticipant.INVITED` → offered; `ADDED` → connected; `HELD` → held; `UNHELD` → resumed; `REMOVED` → wrapupRequired (if ACW) or ended; `SingleStepTransfer` → transferred (`destinationLoginId`); `AfterContactWorkActivated` → wrapupRequired; `AfterContactWorkCompleted` → ended. The agent is the top-level `loginId`; the interaction is `body.engagementId`. | V (event names, fields), A (`engagementId` = the widget's interaction id) |
| X3 | Socket | We send `{subscriptionId, token}` after connecting and `ping` every 30 s. An `error` frame recreates the subscription. The endpoint must be `wss://*.avayacloud.com`. | V (auth message, ping), A (frame shapes) |
| X4 | Wrap-up | `POST /api/interactions/v1/accounts/{accountId}/interactions/{id}/wrapup` with `{dispositionCode, notes}`, after the customer leaves Connected. The widget API `wrapUpInteraction` is the documented equivalent. | A (REST path) |
| X5 | Verify | `GET /api/engagement/v1/accounts/{accountId}/engagements/{engagementId}`. It must return `participants[]` containing `{type: AGENT, loginId, agentId, state ∈ ACTIVE\|CONNECTED\|HELD\|ACW…}`. | A |
| X6 | Widget | A custom element `verbis-script-widget`; `window.WS.widgetAPI(interactionId)` and `onDataEvent('onInteractionEvent')`. The manifest uses `element`, `library` and `requiresInteraction`. | V (API, event), A (manifest keys) |

### Outbound and recording
| # | Topic | What the code does | Conf. |
|---|---|---|---|
| O1 | Record detection | POM: UUI/intrinsics keys `POM_CMP`, `POM_CID`, `POM_CL`. PC: `PC_JOB`, `PC_REC`, `PC_LIST`. Other `k=v` pairs become record fields. This depends on dialer configuration (POM "pass contact attributes", PC job "UUI/ASAI data"). | A |
| O2 | POM result | SOAP `updateContactCompletionCode(campaignName, contactId, completionCode, attributes)` with a Bearer token. The operation name differs between releases; adapt it in `PomWebServiceClient`. | A |
| O3 | PC Agent API | Framing `keyword RS type RS origin RS invokeId RS count [RS data]* LF` (RS = 0x1E). Final responses have type `R` and result code `0`/`M00000`. Commands: `AGTLogon`, `AGTSetDataField`, `AGTFinishedItem <completion code>`. | A |
| O4 | PC logon | A dedicated application account, never agent passwords. Not every PC release permits headless result reporting; the fallback is POM, or the agent's own desktop. | A |
| R1 | Recorder hook | Our own contract: `POST <url>` with JSON `{action: pause\|resume\|tag, commandId, callKey: ucid\|interactionId, call, agent?, extension?, tags?, at}`, headers `x-verbis-signature: t=…,v1=…` (HMAC-SHA256 with secret `recorderSecret`) and `idempotency-key`. A 2xx response means done. The recorder side (Avaya WFO, Verint, NICE adapter) implements it. | — (Verbis contract) |

## 2. Installation guide

### 2.1 Common steps
1. **NATS** (AES/AACC):
   - a JetStream stream `VERBIS_AVAYA` on `verbis.connector.avaya.*.event.v1` (2-minute
     duplicate window, at least one day of retention, replicas 3);
   - one sidecar user per connector, limited to `verbis.connector.avaya.<connectorId>.>`;
   - the hub's credentials go in the vault as `natsCreds`.
2. **Recorder hook** (optional but recommended for PCI):
   - expose the recorder adapter over HTTPS;
   - store the shared secret as `recorderSecret`;
   - set `recording.url`.
3. **Routing:** in admin-web › **Avaya routing**, bind VDNs and skills (AES), skillsets (AACC),
   queues (AXP) and outbound campaigns to Verbis campaigns.
4. **Agents:** provision CTI identities through SCIM (CTI extension) or an admin:
   - `platform: avaya_aes` → ACD login id;
   - `avaya_aacc` → agent handle;
   - `avaya_axp` → AXP login id.

   Email matching is the last fallback.

### 2.2 Aura + AES
1. In AES OAM, create a CTI user with "Unrestricted access" (or a security database restricted to
   the observed devices), and a secure tlink (CSTA-S) towards the CM.
2. In CM, give the agent stations and VDNs to observe. Make sure UCID is enabled
   (`system-parameters features: Create Universal Call ID = y`). Send UUI from the IVR/vectors in
   the agreed format, either `kv` or shared UUI with element ids.
3. Build the sidecar with the JTAPI SDK and run it with `infra/avaya/aes-sidecar.env.example`.
4. Create the connector as `avaya_aes` with kind `sidecar`; see `infra/avaya/connectors.example.json`.

### 2.3 AACC / Contact Center Elite
1. Enable CCMM web services and create a web services account. Its password is a mounted file.
2. In CCT Open Interfaces, subscribe to WS-Notification with:
   - URL `https://<sidecar>/aacc/notify`;
   - header `X-Verbis-Notify-Token: <token>` (the same value as `AACC_NOTIFY_TOKEN_FILE`);
   - topics: contact events for the skillsets that Verbis serves.
3. Configure closed reason codes in CCMM. Map Verbis outcomes to them in `dispositionCodes`.
4. Run the sidecar with `infra/avaya/aacc-sidecar.env.example`. Create the connector as
   `avaya_aacc` with kind `sidecar`, and list only the intrinsics scripts need (`intrinsics`).

### 2.4 Avaya Experience Platform
1. In AXP Administration, create an API client (client credentials) with the interaction,
   notification and engagement scopes, plus an app key. Store `clientId`, `clientSecret` and
   `appKey` in the vault.
2. Create the connector as `avaya_axp` with kind `workspaces`, `host`
   (e.g. `na.api.avayacloud.com`) and `accountId`.
3. **Widget:**
   1. Upload `infra/avaya-axp/widget/verbis-widget.js` with the manifest in Widget Management.
   2. Set `agent-web-origin` and `connector-id`.
   3. Place the widget on an **interaction** tab (it needs interaction context).
4. agent-web must allow framing by the Workspaces origin (`frame-ancestors`), and its session
   cookie must work in the iframe (`SameSite=None; Secure; Partitioned`). This is the same open
   item as Genesys Cloud (ADR-0017 amendment).

## 3. Mapping (envelope / notification → normalized)

| Avaya | Normalized |
|---|---|
| delivered / ContactPresented / MatchOffered, INVITED | `interactionOffered` |
| established / ContactAccepted / ADDED | `connected` |
| held / retrieved / HELD / UNHELD | `held` / `resumed` |
| transferred / ContactTransferred / SingleStepTransfer | `transferred` (+ `transferTo`) |
| cleared + `afterCallWork` / REMOVED (ACW) / AfterContactWorkActivated | `wrapupRequired` (emitted once) |
| cleared / acwCompleted / ContactClosed / AfterContactWorkCompleted | `ended` |
| conferenced, dataChanged, supervisor actions | ignored |

**Attributes:**
- `avaya.ucid`, `avaya.vdn`, `avaya.skill`, `avaya.mediaType`;
- `uui.*` (decoded, allow-listed);
- `intrinsic.*` (allow-listed);
- `outbound.*` (`system`, `campaign`, `recordId`, `list`, plus the allow-listed fields);
- `axp.*` (`channelId`, `customerIdentifier`, custom data).

**Campaign ref:** outbound campaign › VDN › skill/skillset (Aura and AACC); campaign › queue (AXP).

## 4. Commands

| Command | AES | AACC | AXP |
|---|---|---|---|
| `writeAttributes` | not supported (no write into a live call) | CCMM `UpdateContactIntrinsics` | not supported |
| `setWrapUp` | outbound → POM/PC result; inbound → recording `tag` | closed reason (`CloseContact`), plus outbound result when there is a dialer record | Interactions API wrap-up with disposition and notes |
| `pause/resumeRecording` | recorder hook (UCID) | recorder hook (voice only; no-op for digital) | recorder hook (voice only) |

Verification:
- **s2s (AES/AACC):** the hub's event state and the sidecar's own AES/AACC registry must agree.
- **Embedded (AXP):** an Engagement API read on every call (no cache). Outages make the launch fail closed.

## 5. Tests

- **Hub:**
  - 6 fixture scenarios × `runConnectorContract`:
    - AES inbound (VDN, UUI, hold, transfer, ACW) and POM outbound;
    - AACC email and chat transfer;
    - AXP voice (hold, ACW) and chat transfer;
  - adapter specs (UUI allow-list, wrong source, POM result, recorder tag/pause, intrinsics,
    disposition, s2s verify, AXP verify/appkey/outage/wrap-up/pause);
  - `uui.spec.ts`, `recording-hook.spec.ts`;
  - the shared NATS Testcontainers spec.
- **Sidecar:**
  - `AvayaSidecarUnitTest`: UUI encoding, UCID validation, POM detection, PC framing, the CCT
    notification mapper with intrinsics allow-list, XXE refusal, registry, command JSON;
  - `NatsBridgeIT` (Testcontainers NATS).
- **admin-web:** `avaya-routing.spec.ts`.

Run everything with `pnpm test:avaya` (`--typecheck` type-checks first, `--no-java` skips the sidecar).
