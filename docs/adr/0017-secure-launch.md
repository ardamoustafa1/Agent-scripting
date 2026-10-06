# ADR-0017: Secure launch — intents, opaque codes, three launch flows, preview sessions

- **Status:** Accepted · 2026-10-01
- **Amends:** SECURITY §4.2 (opaque server-side code instead of a self-contained EdDSA launch token), DOMAIN Session (adds `kind`)
- **Related:** [SECURITY §4](../SECURITY.md#4-secure-launch-design), [ADR-0004](0004-bff-auth.md), [ADR-0016](0016-runtime-session-engine.md), PROGRESS step 23

## Context

A script screen must open only for a real, live interaction, for the agent it is assigned to, in
that agent's SSO session. URL parameters must never select content. SECURITY §4.2 proposed an
EdDSA-signed launch token; every check still had to run against the server-side `LaunchIntent`.

## Decision

1. **Opaque code, server-side authority.** A launch code is 256 random bits (base64url, 43 chars).
   Only its SHA-256 is stored (`launch_intents.code_hash`); it carries no claims. The intent binds
   tenant, user, interaction, connector and flow; lifetime ≤ 60 s (application cap **and** a DB
   `CHECK`), single use (row lock + `state = 'pending'` CAS + forward-only trigger). This is a
   breaking change of §4.2: no signed launch token is minted, so there is no key to rotate or leak.
2. **Three flows, one redemption path.**
   - *s2s:* `POST /v1/launch-intents` — service principal only, with a certificate-bound token
     (client credentials + mTLS, RFC 8705 `cnf`). The connector names user + interaction; the API
     checks the connector is active, the interaction live and assigned to that user, the user
     active. Delivery `push` (default) keeps the code ≤ TTL in Redis and pushes it after commit
     (outbox `verbis.runtime.launch.offered.v1`) to the user's `/launch` socket (single-use,
     origin-bound ticket). `fragment` returns it for the platform to open `/launch#code=…`.
   - *embedded:* `POST /v1/launch/embedded {connectorId, conversationId}` — a hint only. The API
     finds the interaction, requires it to be live and assigned to the caller, then asks the
     platform through the connector's `PlatformInteractionVerifier` with the user's stored CTI
     identities. No verifier, error, timeout (3 s) or `false` ⇒ deny.
   - *CTI-less:* `POST /v1/launch/jws {token}` — compact JWS signed by a tenant-registered
     `launch_trusted_issuers` JWKS (rotation = several `kid`s; private members rejected by schema
     and DB). Pinned `EdDSA`/`ES256`, `aud = verbis-launch:{tenantId}`, `exp − iat ≤ 60 s`, ±5 s
     skew, required `jti`, `agentId`, `interactionId`; `jti` single-use via Redis `SET NX` (fail
     closed) plus a unique `(tenant_id, jti)` index.
   All flows end in the same redemption: the bound user, a BFF session (`sid`), not break-glass,
   intent pending and unexpired, user active, interaction live and assigned, platform re-verified
   for s2s, script resolved server-side by the `ResolverService`, session created + initialized.
3. **One refusal shape.** Every denial is `403 VERBIS_LAUNCH_DENIED` (no oracle for which check
   failed). The precise reason is written as `launch.attempt.denied` after the request transaction
   rolls back (`AuditedDomainError`, recorded by the outermost failure interceptor).
4. **Rate limit + anomaly.** Failed attempts are counted per user and per IP (5-minute window).
   The 5th failure writes `launch.anomaly.detected` (`alert: true`, forwarded by SIEM export);
   from 10 failures attempts get `429 VERBIS_LAUNCH_RATE_LIMITED` before any lookup.
5. **Preview sessions.** `sessions.kind ∈ {interaction, preview}`; a DB check ties `interaction`
   to a non-null `interaction_id` and `preview` to null. `POST /v1/launch/preview` needs
   `update:Script`; live data sources need `execute:Integration` and an explicit flag, otherwise
   the integration engine refuses preview executions.
6. **Framing.** API responses: `X-Frame-Options: DENY` + `frame-ancestors 'none'`. Agent-web
   documents use `GET /v1/embedding-policy/{tenant}` (tenant setting `embedding.frameAncestors`,
   https origins or `https://*.domain`); no allow-list ⇒ DENY.
7. **Browser.** agent-web reads launch material only from the fragment on the fixed `/launch`
   path, scrubs the URL with `history.replaceState` before any network call, ignores query
   parameters (identifying ones are reported to `POST /v1/launch/param-signals` and audited as
   `launch.urlParams.rejected`).

## Consequences

- connector-hub (step 18+) must call `/v1/launch-intents` with an mTLS-bound client and register a
  `PlatformInteractionVerifier` per connector for embedded launches and s2s re-verification.
- The agent-web edge must apply `/v1/embedding-policy` headers to its HTML responses (api-gateway,
  step 7 extraction).
- Interaction end/wrap-up revokes pending intents.
