# ADR-0012: Identity module in apps/api (BFF in-process), SSO, SCIM, break-glass, service clients

- **Status:** Accepted · 2026-10-01
- **Amends:** [ADR-0004](0004-bff-auth.md) (where the BFF runs), [ADR-0009](0009-workspace-layout.md) (`apps/api-gateway` deferred), [ADR-0011](0011-api-foundation.md) (error-format exceptions, new pre-tenant SECURITY DEFINER lookups)
- **Related:** [SECURITY §4–5](../SECURITY.md), [DOMAIN](../DOMAIN.md), [PROGRESS](../PROGRESS.md) steps 7–9

## Context
Prompt 4 asked for `modules/identity` with the BFF pattern, OIDC and SAML for several IdPs, home-realm discovery, claim → role mapping, JIT provisioning, SCIM 2.0, a break-glass administrator, session management, service-to-service identity (client credentials, mTLS) and a Keycloak end-to-end test. ADR-0004 and CLAUDE.md §3 place the BFF in a separate `apps/api-gateway` (step 7). The request places it in the API's modular monolith. This ADR records that deviation and the decisions made inside the module.

## Decision

### Placement
- The BFF lives in `apps/api/src/modules/identity` until `apps/api-gateway` is extracted. The browser talks to it through each web app's same-origin `/api` proxy, so cookies are first-party.
- Cookie-authenticated requests are resolved **in-process** to the same `Principal` that internal JWTs produce; the rest of the pipeline (AccessGuard, tenant transaction, audit) is unchanged. When the gateway is extracted it will mint internal JWTs instead (`sid` already exists in the claim set).
- `RequestAuthenticator` (common/security) is the seam: the identity module plugs in SCIM bearer tokens and session cookies; internal JWTs keep the original path. Certificate-bound internal tokens (`cnf.x5t#S256`) are checked there too.

### Sessions (BFF)
- Opaque 256-bit session id in `__Host-verbis_session` (httpOnly, Secure, SameSite=Lax by default, `strict` configurable). The Redis key is SHA-256 of the cookie value; the record (including IdP id/access/refresh tokens) is AES-256-GCM sealed with the AAD bound to the key (`Keyring`, `IDENTITY_ENCRYPTION_KEYS`, kid rotation).
- Idle timeout (sliding, touched at most once a minute) and absolute timeout, both enforced by key TTL **and** on read. Tenant `settings.session` overrides env defaults. Concurrent-session limit per user: `evict_oldest` (default) or `deny`.
- CSRF: synchronizer token (`X-CSRF-Token`, returned by `GET /auth/session`) **and** an allow-listed `Origin` (or `Sec-Fetch-Site: same-origin`) **and** JSON-only bodies on every state-changing cookie request.
- Login transactions (state/nonce/PKCE verifier or SAML request id, app, return path) are sealed in Redis for 10 minutes, consumed with `GETDEL`, and bound to the browser by a separate `__Host-verbis_session_tx` cookie (SameSite=None because SAML responses arrive as cross-site POSTs; it carries only a random handle).
- Callback/post-logout URLs come only from `AUTH_APP_ORIGINS` (optionally `{tenant}`-templated for tenant-from-host); return paths are same-origin absolute paths.

### OIDC
- `openid-client` v6: discovery, Authorization Code + PKCE S256, `state`, `nonce`, id_token validation with bounded clock skew. Vendor presets (Entra ID, Okta, Keycloak, Google Workspace, AD FS, Ping, generic) fill scopes, claim names and quirks; everything is overridable.
- Refresh-token rotation: when the IdP access token expires, the refresh token is redeemed under a per-session Redis lock and replaced. A refused refresh ends the Verbis session (IdP logout or token reuse); an unreachable IdP does not.
- Logout: RP-initiated (end_session with `id_token_hint`), Back-Channel Logout 1.0 (signature from IdP JWKS, iss/aud/iat/jti/events, no nonce, `jti` single-use), Front-Channel Logout (iss + sid; page framable only by the IdP).
- All IdP egress goes through `createIdpFetch`: https only (http only for listed dev hosts, refused in production), the connected address is validated inside DNS lookup (DNS-rebinding safe), private ranges only for listed on-prem hosts, no redirects, size and time caps. Step 16's SSRF guard will replace it.

### SAML 2.0
- `@node-saml/node-saml` with: signed **assertions** mandatory; audience, validity window and InResponseTo checked; assertion `Issuer` checked against the IdP entity id (node-saml does not enforce it — found by the tests); assertion id single-use (Redis); transient NameIDs refused; optional mandatory encryption.
- IdP-initiated SSO is refused unless the IdP config sets `allowIdpInitiated` (per tenant IdP).
- SP metadata per tenant IdP: one ACS per app origin, SLO endpoints, signing and encryption certificates. SP credentials are self-signed RSA-3072 (`@peculiar/x509`), private keys in the `secrets` table. Rotation: `next` is published in metadata → promoted to `active` → old becomes `retired` (still decrypts) → removed. Several IdP signing certificates are trusted at once for IdP-side rotation.
- InResponseTo ids are removed only after a successful validation (node-saml removes them on failure, which broke decryption-key fallback); single use is guaranteed by the login transaction and the assertion-id cache.
- SLO: IdP-initiated LogoutRequest (Redirect/POST) and SP-initiated LogoutRequest at logout.

### Tenants, IdPs, discovery
- IdP admin API (`/v1/identity-providers`): config validated with zod, secrets write-only (OIDC client secret → `secrets`, sealed), If-Match versioning, disabling/deleting an IdP ends its sessions.
- Home-realm discovery by email domain (`identity_provider_domains`, globally unique) or tenant slug. Before a tenant is known, two narrow SECURITY DEFINER functions answer: `tenant_resolve(slug)` and `identity_discover_domain(domain)`.

### Users, roles, provisioning
- External identities link to users in `user_identities` (IdP + subject). Linking by email requires a verified email (OIDC `email_verified`, or SAML per-IdP trust); JIT never takes over an existing account with the same email.
- `user_roles.source` separates `manual`, `claims:<idp>` (re-synchronized from claims at every login) and `scim:<idp>` (from SCIM group membership through the same rules). Every grant/revocation is audited.
- SCIM 2.0 at `/scim/v2/<tenant-slug>`: Users and Groups CRUD, strict filter parser compiled through an attribute allow-list, PATCH (Entra/Okta dialects), `application/scim+json`, bearer token per IdP (SHA-256 at rest, expiry, revocation). `active=false`/DELETE revokes sessions immediately and emits `verbis.identity.user.deactivated.v1`.

### Break-glass
- argon2id (OWASP baseline) + mandatory RFC 6238 TOTP with replay protection, enrolled through the admin API and confirmed with a first code. Accepted only from `BREAK_GLASS_ALLOWED_ORIGINS` (admin-web); the session is bound to that origin, single, 60 min absolute / 10 min idle. Lockout after N failures. Every attempt (success or failure) is an audit event marked `severity: critical` plus an outbox alert event.

### Service-to-service
- OAuth 2.0 client credentials at `/oauth2/<tenant-slug>/token` (`client_secret_basic`, `client_secret_post`, `tls_client_auth`), issuing the existing internal JWT (`typ=service`, `scp`, ≤ 5 min) signed with `INTERNAL_JWT_SIGNING_JWK` (kid must be in `INTERNAL_JWT_JWKS`). Secrets are SHA-256 at rest and shown once. mTLS: RFC 8705 certificate-bound tokens; the certificate comes from the TLS socket or a trusted proxy header (`MTLS_CLIENT_CERT_HEADER`). Clients cannot receive permissions their creator lacks.

### Audit and events
- Every login, logout, failed attempt, session revocation, role change, provisioning change, IdP/SCIM/service-client change and token issuance is an `AuditEvent` (the existing hash-chained writer, which also writes `verbis.audit.event.recorded.v1` to the outbox). Failures are recorded in their own committed transaction with actor `service:identity`, never with PII.
- Domain events: `verbis.identity.session.started|ended.v1`, `user.provisioned|deactivated|rolesChanged.v1`, `breakGlass.used|failed.v1`, `identityProvider.created.v1`.

### Error formats (exception to CLAUDE.md §7)
- SCIM endpoints answer RFC 7644 §3.12 errors and the token endpoint RFC 6749 §5.2 errors, because standard clients parse those formats. Browser protocol endpoints redirect back to the app with `?authError=<code>`. Everything else stays RFC 7807; OpenAPI documents each format (`ApiProtocol`).

## Consequences
- (+) One process, one pipeline: cookie and token principals get identical authorization, tenant isolation and audit.
- (+) No token ever reaches the browser; Redis dumps reveal neither tokens nor cookie values.
- (−) The API now terminates browser traffic; extracting `apps/api-gateway` later moves `modules/identity/{login,saml,oidc,session}` and replaces in-process resolution with internal JWT minting.
- (−) `IDENTITY_ENCRYPTION_KEYS` and `INTERNAL_JWT_SIGNING_JWK` come from env until KMS/Vault (OD-3, step 16).
- (−) Front-channel logout cannot rely on cookies (SameSite) and trusts `iss`+`sid`; back-channel is preferred.
- (−) Email-domain claims are not DNS-verified yet.

## Alternatives
- **Separate `apps/api-gateway` now:** matches ADR-0004 literally but doubles session/authorization plumbing before the first consumer exists. Deferred.
- **passport-saml / passport strategies:** session coupling to Express/passport; rejected for direct node-saml and openid-client.
- **Storing sessions in PostgreSQL:** per-request DB writes and no TTL eviction; Redis chosen as in ADR-0004.
