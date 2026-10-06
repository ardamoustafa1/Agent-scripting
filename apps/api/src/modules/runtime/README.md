# Runtime session server

`RuntimeModule` owns existing securely launched sessions, not launch redemption. It exports
`RuntimeEngineService`, `RuntimePorts` and `RuntimeCipher`. No public session-creation route exists.

## Setup

1. Apply migration `20261001080000_runtime`. Do not run the API against the previous schema.
2. Provision `IDENTITY_ENCRYPTION_KEYS` (rotating `kid:base64(32 bytes)` keyring). Runtime PII uses
   fresh AES-256-GCM DEKs wrapped with tenant AAD; ciphertext is also bound to record/purpose.
3. Enable the existing `OUTBOX_RELAY_ENABLED` and `EVENT_CONSUMERS_ENABLED` flags to run committed
   realtime delivery, platform consumption, timeout jobs and connector retry workers.
4. In launch redemption's tenant transaction, set trusted `Session.teamId` and call
   `engine.initialize(sessionId)` after creating the pinned session. The future launch module
   must establish the agent's team from trusted membership; the browser cannot set it.
5. Register connector implementations by connector UUID and a PSP/tokenization verifier with
   `RuntimePorts`. Defaults fail closed. Connector calls must deduplicate stable `commandId`
   across process restarts, timeouts, failed commits and retries.

## HTTP / browser protocol

All commands pass through existing BFF authentication, CSRF, tenant transaction and CASL guards.
`POST /v1/sessions/:id/attach` takes a per-tab UUID. The first tab gets a random write token and
60-second lease; another tab gets `readOnly: true` and no token. Renew every 20 seconds with the
same tab UUID **and existing write token**. Keep the token in tab memory/session storage, never
URLs, logs or shared local storage. Expired leases issue new tokens and fence old ones.

Commands, outcome, secure-field, recording and transfer routes require `expectedSequence`,
`tabId`, `writeToken` in the JSON body. A stale sequence returns 412 with the current ETag.
Read/state responses are always read-only; only a successful attach or owner takeover grants write capability.
`POST :id/takeover` with `{ tabId }` rotates an owned session's writer token and audits the handoff.
`POST :id/release` requires the current BFF/tab/token and releases the lease; browser pagehide uses
CSRF-authenticated keepalive fetch. Previous tokens remain fenced after takeover. Terminal sessions cannot acquire leases. One owner may operate multiple independent sessions.

Request a socket ticket with `POST /v1/sessions/:id/socket-ticket` and `{ afterSequence }`, then
connect Socket.IO `/runtime`, websocket-only, with `auth: { ticket }`. Origin must match the
HTTP issuance origin. Tickets expire after 30 seconds and are consumed once; reconnect obtains
a fresh ticket. Cookies/tokens are not accepted in WebSocket URLs. BFF revocation and current
ABAC grants are checked on admission and every 15 seconds. Messages never mutate state.

`runtime.resume` contains a snapshot watermark and up to 200 contiguous redacted events, or
`reset: true` when replay is incomplete. `runtime.event` carries sequence/state/event metadata.
Events can arrive before resume or be duplicated/reordered across retry workers: buffer until
resume, ignore sequence <= snapshot watermark, apply only contiguous higher sequences and
request a new ticket on gaps. The Redis Socket.IO adapter broadcasts across API instances;
NATS JetStream/outbox supplies durable delivery. Redis pub/sub is not itself a replay log.

## State and security

`launching` is Created for compatibility; Active, Paused, WrapUp and terminal states are explicit.
Completed requires a campaign disposition. PostgreSQL row locks and sequence CAS serialize
changes, including connector events. SessionEventWriter appends the corresponding hash-chained
redacted event in the same transaction; terminal sessions seal the chain. Action/DataSource
executors can call `recordActivity()` with bounded metadata; it accepts no upstream bodies.

Redis carries encrypted, sequence-bound hot variables/page/history/timers. PostgreSQL carries an
encrypted, classification-filtered snapshot: `persist:false` and PCI values are omitted. Redis
loss restores only declared persisted values. Failed transactions cannot expose their cache
entries because readers compare the committed DB sequence. Legacy plaintext snapshots are not
served; initialize/rewrite or migrate them explicitly if an old deployment has live sessions.

PCI input goes directly from the browser's hosted PSP field to the token provider. The API only
accepts `tok_...` receipts verified by the registered server provider; generic field commands
reject PCI variables. Token receipts/values never enter snapshots, Redis, events, audit or API
responses. Verified opaque tokens remain in bounded local process memory for at most 60 seconds,
are inaccessible after expiry, and are cleared on page leave/session end. Moving to another API
instance requires tokenization again; no PAN/CVV is sent to Verbis. Recording pause/resume is an
asynchronous connector hook; hosted secure-field capture must wait for provider/platform pause
acknowledgement when required by the deployment.

Campaign `outcomeSet[].requiredFields` names declared non-PCI variables; type, mandatory note,
code and sub-code validation precede completion. Notes/fields are separately envelope-encrypted.
BullMQ jobs carry IDs only (recording jobs also carry a boolean), retry eight times with exponential
backoff/jitter and retain failures for operator inspection/retry. Active/paused sessions abandon
at 30 minutes without domain activity; launching sessions expire, wrap-up expires at 15 minutes.
Obsolete timeout jobs are harmless because they recheck the current deadline under the row lock.

## Connector events and transfer

Authenticated connector-hub emits `verbis.interaction.contact.changed.v1` in `INTERACTION` with
aggregate id = normalized interaction UUID. Payload is `{ interactionId, connectorId, sealed }`.
Before publication, seal the complete `InteractionSchema` JSON with the same runtime envelope
format and AAD `runtime:interaction:<tenantId>:<interactionId>`; never put raw ANI/DNIS/attached
or participant data in the outbox/NATS/DLQ. The producer must be authenticated/subject-authorized
by the deployment's NATS ACLs. The consumer verifies connector/platform identity and tenant
membership, ignores stale occurrence timestamps and publishes redacted platform state events.
Adapters must supply authoritative UTC event timestamps and a full normalized contact snapshot.

Transfer targets an existing securely launched session of the new platform-assigned agent with
the same pinned script/interaction. Both session sequences are checked. The tenant policy
`settings.runtime.transferableVariables` is a deny-by-default allowlist; only declared persisted
public/internal variables transfer. The old agent cannot edit a transferred interaction.

`GET /v1/supervisor/sessions` lists live sessions under instance CASL/team scope. Supervisor state
and socket-ticket endpoints are read-only and mask PII; watch reads are audited. Sessions without
a trusted team assignment are denied to team-scoped supervisors.

## Tests (written, not executed)

```sh
pnpm --filter @verbis/api test:runtime
pnpm --filter @verbis/api exec vitest run --project integration test/integration/runtime.int.spec.ts
```

State transitions, terminal fencing, token boundaries, encryption rotation/isolation, Redis
recovery, ticket replay/origin/revocation, gateway reconnect, real PostgreSQL racing writes,
second-tab fencing, transactional rollback, PII masking and tenant isolation are covered by the
written suites. Coverage and real provider/Redis-adapter end-to-end behavior are unverified.
