# Agent desktop

`apps/agent-web` serves the day-to-day agent workspace. It uses SSO BFF cookies and CSRF, secure
launch offers, the pinned script document, real core-runtime rendering and the existing sequenced
session API. No query parameter can select a script, agent, campaign or interaction.

## Deployment

1. Configure SSO for the agent application (`/auth/login?app=agent`), matching browser origins,
   BFF callback URLs and secure-launch policies. Register connector agent identity mappings and
   assign a published script to the campaign. Configure its disposition set and pinned sources.
2. Start PostgreSQL, Redis, NATS, API and connector-hub with existing documented environment
   settings. Runtime event consumers, outbox publishing and BullMQ workers must run: they deliver
   offers/platform updates and execute queued write-back. A returned outcome is not connector ACK.
3. `pnpm --filter @verbis/agent-web dev` serves port 5174 by default. Vite proxies `/api` and
   `/socket.io` to `API_INTERNAL_URL`. For deployment use the production web image and same-origin
   reverse proxy; forward Socket.IO websocket upgrades. Do not expose API secrets through VITE vars.
4. Use HTTPS for WebCrypto and IndexedDB. For iframe deployments configure server CSP
   `frame-ancestors`, connector/widget origin policy and an authenticated cookie topology supported
   by the host browser. Cross-site cookie blocking requires a supported same-site host/BFF setup.
   Compact mode is detected from the frame; it does not establish identity or authorization.
5. Supervisor visibility requires the backend-scoped supervisor/administrator role. Observation
   uses the existing masked supervisor endpoints; the owner desktop endpoint never returns another
   agent's trusted context.

## Workspace behavior

Each interaction tab creates its controller on first activation, then retains its renderer, sequence watermark and memory-only writer token. Unvisited tabs defer attach and runtime socket tickets; inactive panels are hidden and inert. Channel/customer labels use assignment order, with keyboard Home/End and arrow selection.
Launch offers remain connected while sessions are open. The waiting screen shows connection-channel
status and recent sessions (channel connectivity is not a vendor health probe). Tabs support arrow,
Home/End selection and unread badges. Header, script, optional side panels, chat transcript and page
progress use token styles, logical properties and TR/EN messages. Font size, density and themes are
agent preferences. Enter advances validated pages, Alt+Left goes back, Ctrl+/ shows shortcut help.
Language changes preserve the controller and writer lease.

Context sidebar fields are connector-provided: `history`, `knowledge`, `objections` arrays, plus
`channel.chat.transcript` from normalized chat events. No invented CRM or knowledge API is called.
Transferred sessions revoke the old writer; hold/resume and customer disconnect update editability
and wrap-up banners. Outcome fields, note, subcodes and callback are checked by the server; PCI fields
are excluded from browser persistence and ordinary wrap-up inputs. Secure payment capture requires
the existing provider flow. Platform recording/attribute operations not exposed by the desktop BFF
fail closed, rather than displaying success.

## Recovery and security

- Drafts contain dirty non-PCI field values, conflict bases, notes, disposition and callback only.
  AES-256-GCM uses non-extractable persisted keys, fresh IVs and tenant/user/BFF/session AAD. Tokens,
  CSRF and PCI values are never written to drafts. Authenticated scripts/results remain memory-only.
- Saves resolve after IndexedDB transaction commit. A saving indicator and unload guard protect
  pending writes; storage failures remain visible. Browser destruction before a transaction commits,
  storage eviction, device failure and expired BFF partitions cannot provide an absolute zero-loss
  guarantee. This release does not claim that acceptance criterion has been measured or proven.
- Field writes are serial, fenced and versioned. A 412 re-fetches authoritative state; conflicting
  values remain encrypted until the agent chooses server values or explicitly reapplies the draft.
  A different script checksum fails closed and retains the draft for support recovery.
- Reconnect uses fresh origin-bound socket tickets and backoff. Replayed notifications trigger an
  authoritative HTTP refresh, not blind event application. Page navigation waits for durable field
  synchronization. Pagehide and controller disposal attempt a CSRF-authenticated keepalive lease release.
  If release cannot reach the server, the owner can use “Take over in this tab”; this rotates the token,
  fences the previous writer, checks pending draft conflicts and records an audit event. Terminal or
  transferred sessions and other users cannot take over. Tokens remain in memory. The 60-second TTL
  remains a recovery fallback; the first runtime socket resume does not repeat a valid attach.
- Logout clears the current draft partition and query cache. Old BFF partitions are not silently
  transferred to a new authentication session. Recovery across SSO session expiration requires a
  separately authorized retention/migration design.

## Tests and performance acceptance

Unit tests cover resume without replay, navigation fences, writer separation, encrypted draft
payload exclusions, incompatible versions, owner-only reads, exact source pins, connector ACK and
platform lifecycle. Playwright covers SSO/query rejection, keyboard/theme/axe, encrypted IndexedDB
refresh, and an opt-in real simulator-to-write-back path. **None were executed during implementation.**

Future commands (only run when requested):

```sh
pnpm test:agent
pnpm test:agent --e2e
```

The live test is skipped unless all three variables are set: `AGENT_E2E_CONNECTOR_ID`,
`AGENT_E2E_PLATFORM_USER`, `AGENT_E2E_STORAGE_STATE` (a local uncommitted SSO storage-state file).
Use a dev tenant, `SIMULATOR_ENABLED`, mapped agent and a published two-page script with a customer
input, Lookup action backed by a pinned dev-safe integration, and a Success disposition. The SSO
fixture needs agent session permissions plus `manage:Connector` for simulator setup. Optional
`AGENT_E2E_INPUT_LABEL`, `AGENT_E2E_LOOKUP_LABEL`, `AGENT_E2E_OUTCOME_LABEL` match tenant content.
Do not use production customer data or commit authentication storage files.

The renderer chunk is loaded after SSO while the agent waits. Owned active-session documents are
prefetched through the same owner-only BFF into a short-lived, authentication-partitioned memory
query cache; mounting shares the in-flight fetch and still renews server writer authority. Initial script bootstrap combines
pinned document/context/outcomes; images/components use existing registry behavior. The production
build emits asset sizes. The 1.5s / cached 500ms / transition 100ms targets still require browser
measurement on representative devices and real network latency; build completion is not evidence
that these budgets or zero axe violations have passed. Service-worker/offline cold-start support
and finer component bundle splitting are follow-ups.

Opt-in measured budgets are authored in `e2e/performance.spec.ts`. Set
`AGENT_E2E_PERFORMANCE=1` plus `AGENT_E2E_SESSION_ID` and SSO storage state for a valid active
multi-page session with required inputs prefilled. This test mutates the test session by advancing
one page. It separately checks 1500ms initial, 500ms cached render and 100ms page change; it waits
for any prior writer lease to expire before measuring navigation. It has not been run.

## Error support and data source fallback

Session load/action failures distinguish script, authorization, network and draft storage failures.
The UI displays a copyable correlation/support code and reports only the category and code to the
owner-only `/desktop/failure` audit endpoint; upstream details, script props and field values are omitted.
Push-offer redemption failures are visible in the workspace as well as fragment launch errors.

A script data source can declare `policy.onFailure: "block" | "continue" | "manual"` (omission means
block). Retry re-evaluates current inputs. Continue/manual recovery requires the current writer and
matching pinned script policy on the server, and is audited. Manual fallback requires mapped,
non-payment scalar values; normal field typing, required-read and page validation still apply.
Authored action `onError` and flow error edges retain control of their existing fallback.
