# Genesys Cloud connector

Related: [ADR-0008](../adr/) (connector SDK) · [ADR-0017](../adr/) (secure launch) · [SECURITY §4](../SECURITY.md) · [PROGRESS step 19](../PROGRESS.md)

Code:
- hub adapter: `apps/connector-hub/src/connectors/genesys-cloud/`
- region table: `packages/sdk-connector/src/platforms/genesys-cloud.ts`
- agent identity link (PKCE, BFF): `apps/api/src/modules/connectors/genesys-cloud/`
- widget popup: `apps/agent-web/src/launch/genesys-link*.ts(x)`
- routing UI: `apps/admin-web/src/genesys/`
- manifests: `infra/genesys-cloud/`

## 1. API check (2026-10-01) and assumptions

The Developer Center (developer.genesys.cloud) renders client-side, so it could not be read
automatically. We checked the endpoints against the official generated SDK sources on GitHub
(`MyPureCloud/platform-client-sdk-javascript`: `PureCloudRegionHosts`, `ConversationsApi.md`,
`NotificationsApi.md`). Confidence: **V** = verified in those sources, **A** = assumption from
the platform documentation as we know it. Re-check every **A** against a sandbox org before go-live.

| # | Topic | What the code does | Conf. |
|---|---|---|---|
| 1 | Regions | 18 regions: `mypurecloud.com`, `use2.us-gov-pure.cloud`, `usw2.pure.cloud`, `cac1.pure.cloud`, `sae1.pure.cloud`, `mxc1.pure.cloud`, `mypurecloud.de`, `euc2.pure.cloud`, `mypurecloud.ie`, `euw2.pure.cloud`, `edee1.eusc-pure.cloud`, `mec1.pure.cloud`, `aps1.pure.cloud`, `apse1.pure.cloud`, `mypurecloud.com.au`, `mypurecloud.jp`, `apne2.pure.cloud`, `apne3.pure.cloud`. Hosts are `api.` / `login.` / `streaming.` / `apps.` + domain. Hosts come only from this allow-list (SSRF). | V (domains), A (`streaming.` host) |
| 2 | Server auth | `POST https://login.<domain>/oauth/token`, `grant_type=client_credentials`, HTTP Basic `clientId:clientSecret`. Token cached until 60 s before `expires_in`; refreshed once on 401. | A |
| 3 | Agent auth | Authorization Code + PKCE (S256): `GET login.<domain>/oauth/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256`; then `POST /oauth/token` with `grant_type=authorization_code&code&redirect_uri&client_id&code_verifier` and **no secret** (a public client with the PKCE grant). The implicit grant is not used. | A |
| 4 | Who is the user | `GET /api/v2/users/me` and `GET /api/v2/organizations/me`. The org must equal `config.organizationId`. | V (paths), A (scopes `users:readonly organization:readonly`) |
| 5 | Participant check | `GET /api/v2/conversations/{conversationId}`. Agent legs have `purpose ∈ {agent, user}` + `userId`. Media lists are `calls`, `callbacks`, `chats`, `emails`, `messages` (`messages[].type`: `sms`, `whatsapp`, `webmessaging`, `open`, `facebook`, …). | V (path), A (field names) |
| 6 | Notifications | `POST /api/v2/notifications/channels` returns `{id, connectUri, expires}`. `PUT …/channels/{id}/subscriptions` replaces the subscription list. Limit: 20 channels per user/app. We use 1,000 topics per channel. | V (paths, 20 channels), A (1,000 topics) |
| 7 | Topics | `v2.users.{userId}.conversations` and `v2.routing.queues.{queueId}.conversations`. Each frame carries the full conversation snapshot in `eventBody`. | A |
| 8 | Socket | A heartbeat comes every ~30 s on `topicName: channel.metadata`. `v2.system.socket_closing` is sent before the server closes. Channels live 24 h. | A |
| 9 | Attributes | `PATCH /api/v2/conversations/{id}/participants/{participantId}/attributes` with `{attributes: {k: "string"}}`, written on the **customer** participant. Values are strings. | V (path), A (string-only values) |
| 10 | Wrap-up | `POST /api/v2/conversations/{calls\|callbacks\|chats\|emails\|messages}/{id}/participants/{pid}/communications/{commId}/wrapup` with `{code: <wrapupCodeId>, notes}`. Verbis codes map to Genesys ids through `config.wrapUpCodes`. A code that is already a UUID is passed through. | V (path), A (body) |
| 11 | Secure pause | `PATCH /api/v2/conversations/calls/{id}` with `{recordingState: "paused" \| "active"}`. The SDK describes this as "update a conversation by setting its recording state". The notification `calls[].securePause` flag is informational only. | V (path), A (enum values) |
| 12 | Dialer | The customer participant has the attributes `dialerCampaignId`, `dialerContactListId` and `dialerContactId`. Row data: `GET /api/v2/outbound/contactlists/{listId}/contacts/{contactId}` returns `{data: {...}}`. | A |
| 13 | Rate limits | HTTP 429 with `Retry-After` (seconds; HTTP-date is also accepted). We cap the wait at 60 s and make at most 4 attempts. After that the command fails with `genesys_rate_limited` (retryable), and the hub's delivery queue retries it later. | A |
| 14 | Widget | Integration type `embedded-client-app-interaction-widget`. The URL interpolates `{{gcConversationId}}` (also `gcHostOrigin`, `gcTargetEnv`, `gcLangTag`). Sandbox and permissions are configurable. | A |

## 2. Installation guide

1. **Connector (Verbis admin).** Create a connector with adapter `genesys_cloud` and the config
   from `infra/genesys-cloud/connector.example.json`. Store the service client's `clientId` and
   `clientSecret` in the secret vault and reference them through `secretRefs`. Then activate the
   connector; the hub picks it up within `HUB_CONFIG_REFRESH_SECONDS`.
2. **OAuth clients (Genesys admin).** Create the clients described in `infra/genesys-cloud/oauth-clients.json`:
   - a **Client Credentials** client with a dedicated "Verbis Connector" role. Grant only the permissions listed there.
   - a **PKCE** client. Its redirect URI must be exactly `https://<agent-web origin>/api/v1/genesys-cloud/oauth/callback`, and the same value goes into `userAuth.redirectUri`.
3. **Interaction Widget (Genesys admin).** Go to Admin › Integrations › + › *Interaction Widget*, or
   call the API with `infra/genesys-cloud/interaction-widget.integration.json`. Set:
   - URL: `https://<agent-web origin>/launch#connector=<connectorId>&conversation={{gcConversationId}}`.
     The values sit in the URL **fragment**: agent-web reads and scrubs it, and the server treats it
     only as a hint (CLAUDE.md rule 11).
   - Sandbox: `allow-scripts,allow-same-origin,allow-forms,allow-popups,allow-popups-to-escape-sandbox`.
     The popups are needed for the account link (§3).
   - Groups: the agent groups that use Verbis. Communication types: call, callback, chat, email, message.
   - Activate the integration.
4. **Framing.** Add `https://apps.<domain>` to agent-web's `frame-ancestors` (frame policy, ADR-0017).
   The BFF session cookie must be `SameSite=None; Secure; Partitioned` so it works inside the iframe.
5. **Routing.** In admin-web › *Genesys Cloud routing*, bind Genesys queue ids and outbound campaign
   ids to Verbis campaigns. Bindings are stored as `campaign_external_mappings` with platform
   `genesys-cloud` and kind `queue` or `campaign`. The connector emits `campaignRef`:
   - for dialer calls: `campaign` with `dialerCampaignId`;
   - otherwise: `queue` with the agent or ACD participant's `queueId`.
6. **Users.** Agents are matched through CTI identities (`platform: genesys_cloud`). These come from
   the one-time PKCE link (§3), from SCIM, or from an admin.

## 3. Identity

- **Agent (widget).** On the first embedded launch without a linked identity, agent-web shows
  *Link your Genesys Cloud account*. The flow:
  1. A **first-party popup** opens on the agent-web origin. The iframe's own cookies may be
     partitioned, so the popup carries the BFF session.
  2. In the popup, `GET /api/v1/genesys-cloud/connectors/{id}/oauth/authorize` stores a sealed,
     single-use state in Redis (5 min). The state holds the user, the session and the PKCE verifier.
     The request then redirects to Genesys login.
  3. The callback `GET /api/v1/genesys-cloud/oauth/callback` does the following:
     - takes the state with GETDEL;
     - requires the same Verbis user and session;
     - exchanges the code with the verifier;
     - checks the org;
     - refuses a Genesys user that is already linked to another Verbis user (`identity_conflict`);
     - stores `{platform: genesys_cloud, id, connectorId}` and audits `user.ctiIdentity.linked`
       (failures are audited as `user.ctiIdentity.linkDenied`).
     The Genesys token is used once and then discarded. It never reaches the browser.
  4. `/genesys/linked#status=…` posts a same-origin message to the opener and closes. The widget
     then re-runs the embedded launch.
- **Server.** The connector-hub uses Client Credentials only (§1.2).

## 4. Secure launch (embedded flow, ADR-0017 b)

`POST /v1/launch/embedded {connectorId, conversationId}` → API (interaction live + assigned) →
hub `verify-participant` → `GenesysCloudConnector.verifyParticipant`:
- It runs `GET /api/v2/conversations/{id}` with the connector's credentials on every call (no cache).
- It returns true only when the user has an agent leg that is *current*:
  - connected, including held; or
  - in pending after-call work (disconnected, `wrapupRequired`, no wrap-up yet); or
  - alerting, but only when `verifyAlerting` is set.
- A 404 or an invalid id gives false. Other errors propagate, and the hub turns them into false
  (fail closed).

## 5. Events

- The hub subscribes to queue topics (`queueIds`) and user topics (`userIds`, plus queue members
  when `subscribeQueueMembers` is set).
- Topics are sharded at 1,000 per channel, with at most 20 channels.
- Each channel:
  1. creates the channel;
  2. checks that `connectUri` is `wss://streaming.<region domain>`;
  3. subscribes **before** it opens the socket.
- Heartbeat silence over 95 s means the socket is dead, and the hub reconnects with jittered backoff.
- When `socket_closing` arrives, or 30 min before the channel expires, the hub creates a new
  channel, subscribes and opens it, and only then closes the old one (make-before-break, so there
  is no gap). Duplicates from the overlap, or from user and queue topics carrying the same
  snapshot, are dropped.
- Snapshot → event mapping (`mapper.ts`):

  | Snapshot | Event |
  |---|---|
  | alerting, offering, dialing, contacting | `interactionOffered` |
  | connected + `held` | `held` |
  | connected again after a hold | `resumed` (id bound to the hold start) |
  | connected | `connected` |
  | disconnected + `wrapupRequired` and no wrap-up | `wrapupRequired` (timeout from `wrapupTimeoutMs`) |
  | otherwise | `ended` |
  | previous agent leg `disconnectType = transfer` while a new agent leg is active | `transferred` (`transferTo`) + the new leg's event |

- Event ids are `conversationId:participantId:<state>[:discriminator]`. They are stable, so
  redeliveries are idempotent.
- Channels:
  - `calls` → voice; `callbacks` → callback; `chats` → chat; `emails` → email
    (`body` is empty for now, see follow-ups).
  - `messages`: `sms` → sms, `whatsapp` → whatsapp, `webmessaging`/`open`/other → chat,
    `facebook`/`instagram`/`twitter` → social (without a context).
- Customer participant data becomes event attributes. Keys are normalised to `[A-Za-z0-9_.-]`,
  only scalar values are kept, and there are at most 200 keys.
- **Backpressure:** frames that arrive while the hub queue is full are buffered (500) and retried
  with backoff. On overflow the oldest frame is dropped, and its conversation is re-fetched with
  GET once the queue drains, so nothing is lost silently.

## 6. Write-back

| Command | Genesys call | Notes |
|---|---|---|
| `writeAttributes` | `PATCH …/participants/{customer}/attributes` | Keys prefixed with `attributePrefix` (default `Verbis.`); values stringified. Use for script outcome, notes, fields. |
| `setWrapUp` | `POST …/{media}/{id}/participants/{agent}/communications/{comm}/wrapup` | `code` mapped through `wrapUpCodes`; `notes` = `[subCodes] note` (≤ 4,000). Unmapped code ⇒ `genesys_wrapup_unmapped` (not retryable). |
| `pauseRecording` / `resumeRecording` | `PATCH /conversations/calls/{id}` `recordingState` | Voice only. Digital interactions have no recording to pause, so the command is a logged no-op. |

All commands are deduplicated by `commandId`. 429 and 5xx responses are retried as described in §1.13.

## 7. Outbound dialer

Preview, progressive and predictive calls carry `dialerCampaignId`, `dialerContactListId` and
`dialerContactId`. On `interactionOffered` or `connected`, the connector reads the contact row and
copies the **allow-listed** columns (`dialer.contactColumns`) into `contact.<column>` attributes.
`importAll` copies every column; it is off by default for data minimisation. Scripts read these
values as variables.

## 8. Tests (fixtures + contract kit)

Fixtures are in `apps/connector-hub/src/connectors/genesys-cloud/fixtures/`:
- voice with hold and ACW;
- dialer preview with contact data;
- WhatsApp with a blind transfer;
- email; callback; web messaging;
- invalid payloads.

Each scenario runs the shared `runConnectorContract`. The in-memory `FakeGenesys`
(`apps/connector-hub/src/test/fake-genesys.ts`) serves:
- tokens;
- the latest snapshot per conversation, which drives `verifyParticipant`;
- contact rows;
- notification channels;
- scripted 429/5xx responses.

Socket behaviour (heartbeat, `socket_closing`, drop, expiry renewal, sharding) is tested with
fake timers and `FakeSocket`.

Commands (or all at once: `pnpm test:genesys`, add `--typecheck` to type-check first):

```bash
pnpm --filter @verbis/connector-hub exec vitest run src/connectors/genesys-cloud
pnpm --filter @verbis/sdk-connector exec vitest run src/platforms
pnpm --filter @verbis/api exec vitest run src/modules/connectors/genesys-cloud
pnpm --filter @verbis/agent-web exec vitest run src/launch/genesys-link.spec.ts
pnpm --filter @verbis/admin-web exec vitest run src/genesys
```

### 8.1 Sandbox contract test (real Genesys Cloud org)

`sandbox.contract.spec.ts` runs against a **real** Genesys Cloud sandbox org and validates the
live responses with the same zod schemas the connector uses, so a vendor API drift fails here,
not in production. It is skipped unless `GENESYS_SANDBOX=1`. It is read-only, except for one
notification channel, which expires on its own after 24 h.

| Variable | Required | Purpose |
|---|---|---|
| `GENESYS_SANDBOX_REGION` | yes | Region key from the allow-list (e.g. `mypurecloud.ie`) |
| `GENESYS_SANDBOX_CLIENT_ID` / `GENESYS_SANDBOX_CLIENT_SECRET` | yes | Client-credentials OAuth client of a synthetic sandbox org with least privilege. Never use a production org. Pass these from a secret store; they are never logged. |
| `GENESYS_SANDBOX_USER_ID` | yes | User whose `v2.users.{id}.conversations` topic is subscribed |
| `GENESYS_SANDBOX_QUEUE_ID` | no | Validates queue members with `MembersSchema` |
| `GENESYS_SANDBOX_CONVERSATION_ID` | no | Validates a conversation with `ConversationSchema` |

It covers rows 2, 4, 6, 7 and 8 of §1: token, organization, channel, subscription, and the
`channel.metadata` heartbeat on the `streaming.` host. Rows 5 and 12 are covered when the
optional ids are set.

```bash
GENESYS_SANDBOX=1 pnpm --filter @verbis/connector-hub exec vitest run src/connectors/genesys-cloud/sandbox.contract.spec.ts
```

Status: written, but **not yet run against a sandbox org** (no credentials in this environment).
Until it passes, the **A** rows in §1 stay assumptions.
