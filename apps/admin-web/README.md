# Admin workspace

Tenant-scoped BFF administration with TR/EN, light/dark/high-contrast themes, keyboard navigation,
CASL menu hints, server authorization, version-fenced updates, readable errors and lazy page bundles.
`CLAUDE.md` remains the project constitution. No tests were executed during this implementation.

## Start

```sh
pnpm install --frozen-lockfile
pnpm --filter @verbis/shared-types build
pnpm --filter @verbis/script-schema build
pnpm --filter @verbis/expr build
pnpm --filter @verbis/authz build
pnpm --filter @verbis/i18n build
pnpm --filter @verbis/ui build
# With the existing development infrastructure and API configured:
pnpm --filter @verbis/admin-web dev
```

Default port: **5175**. The same-origin `/api` proxy targets `API_INTERNAL_URL`; production uses the
existing nginx/BFF deployment. Credentials remain in httpOnly BFF cookies. Form mutations carry the
CSRF value from `/auth/session`; edits carry `If-Match: "<version>"`. Failed writes retain editable
form values, except secret inputs, which clear after every submission. A 412 never becomes success.
Query keys include tenant and user; logout clears the query client. No credential values enter query
caches or browser storage. SCIM/TOTP enrollment values appear only in a transient, dismissible dialog.

## Database setup (operator action; not executed here)

Apply migration `20261003120000_admin_workspace` using the owner migration connection:

```sh
pnpm --filter @verbis/api db:migrate
```

The migration adds FORCE-RLS privacy requests and narrowly scoped platform control-plane functions.
A deployment operator must designate the **existing, trusted platform tenant** with
`settings.platform=true` and assign its existing SSO user the system `super_admin` role. Bootstrap this
through the existing controlled seed/provisioning workflow. Tenant settings PATCH cannot set the
platform flag; API-created tenants cannot receive the platform role. Do not grant BYPASSRLS to
`verbis_app`. The platform SQL functions must be owned by the controlled migration role that already
owns the control-plane functions; retain their fixed search path and revoked PUBLIC privileges.

## Sections and backing APIs

| Section       | Behavior                                                                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenants       | SSO platform SuperAdmin only; create, suspend/reactivate, quotas and boolean feature flags. Tenant version fencing; system roles bootstrap without SuperAdmin. Registry bounded to 500 tenants.                                                                                                          |
| Identity      | OIDC discovery through SSRF-controlled BFF egress; bounded SAML upload rejects DOCTYPE/entities and checks signing certificates. New IdPs are drafts. Claim/default-role editing; write-only client secret replacement; SCIM issuance/revocation; break-glass TOTP enrollment, activation and disabling. |
| Users / roles | Paginated users, source-aware manual role assignments, custom permission matrix with grant ceiling, campaign/team/site scopes, active sessions and explicit termination confirmation. IdP/SCIM assignments stay at their source.                                                                         |
| Connectors    | Nested config with UUID-only `config.secrets` aliases and tenant-owned `secretRefs`; actual supervisor health probe; redacted connector audit stream polling; user mappings; generic queue/campaign/skill mappings plus existing Genesys/Avaya/attached-data editors.                                    |
| Secrets       | Metadata, rotation, last use, key version and an audited integration usage query. Values have no read endpoint.                                                                                                                                                                                          |
| Audit         | Server search/action/resource/actor/correlation/time filters, keyset pages, colored snapshot/patch diff, correlation chaining, CSV/JSON download, verified chain range with explicit truncation state. SIEM syslog TLS / HMAC webhook / Kafka target creation and enable/disable/removal.                |
| Security      | Session policy, IPv4/IPv6 CIDR enforcement, current-admin lockout prevention, HTTPS frame ancestors, SoD and public launch JWKS rotation with overlap. EdDSA/ES256 only; private keys refused.                                                                                                           |
| Data          | Audit/session retention and legal hold, analytics retention configuration, classification catalog, verified subject requests and bounded privacy processing/export.                                                                                                                                      |
| Brand         | HTTPS logo, accessible computed brand colors and agent title/waiting text; agent-web consumes saved policy.                                                                                                                                                                                              |
| Simulator     | Existing non-production interaction simulator with cookie/CSRF and lifecycle command log.                                                                                                                                                                                                                |
| Health        | Actual API/Postgres/Redis/NATS readiness (including 503 detail), connector metadata, tenant outbox depth/dead letters/requeue, last-24-hour integration execution failure ratio. No-sample rate is unknown, not zero.                                                                                    |

## Security and operational boundaries

- Menu hints use `/v1/me/permissions` packed CASL rules, including inverted rules and `manage all`.
  All endpoints independently enforce their permissions and tenant RLS. User mapping also checks the
  concrete user; missing team/site subject attributes fail closed.
- IP policy applies to authenticated API traffic, including service clients. Configure the trusted
  reverse-proxy chain and include required connector/service networks before enabling an allowlist.
  Health/auth discovery routes remain public under their existing rate limits. Saving a policy that
  excludes the current trusted request IP is rejected.
- Connection tests verify **OIDC discovery** or **SAML endpoint reachability**, not authenticated SSO.
  Complete an SSO round trip in a separate test session before activating an IdP. SAML errors include
  actual HTTP status; reachability alone does not prove protocol correctness.
- Connector debug is a redacted, tenant-scoped **audit event stream**, refreshed every ten seconds;
  it does not expose raw vendor payloads or credentials. Vendor adapter schema/health stays authoritative.
- Quotas fence new JIT/SCIM users, scripts and active/preview runtime sessions with a tenant-row lock.
  Lowering a limit does not delete existing records. Feature flags are persisted for feature consumers;
  adding a new flag requires its consumer to check it.
- Audit/session retention is consumed by the existing archive worker as a **minimum legal retention**,
  not an immediate purge command. Analytics retention is stored but **no analytics purge worker is
  implemented by this change**. Classification catalog entries document field purpose; actual
  masking/persistence uses script `Variable.classification` and integration schemas.
- Privacy processing searches exact `customerId`/`ani` at the root or under `attachedData`. It refuses
  tenants with more than 1000 interactions instead of claiming a partial scan is complete. Export is
  a minimal interaction/identifier export, not a full organization-wide DSAR. External CRM, object
  storage, archives, backups and analytics need the organization's separate approved privacy workflow.
- Anonymization refuses legal hold and active runtime sessions. It clears matched operational
  interaction/session/outcome fields and Redis hot state. Cache generations include database version
  so other replicas cannot return earlier secure values. Hash-chained session event sequence is
  unchanged; immutable audit/session-event history is preserved. Sealed subject/reason records remain
  evidence of the request and require their own retention policy.
- Admin UI/API/database requests are not a substitute for a deployed connector, a SCIM provider or
  the running archive/SIEM worker. Queued or unavailable services stay visibly unavailable.

## Verification commands (authored, not run)

```sh
pnpm test:admin
# Requires migrated development PostgreSQL and app-role credentials:
pnpm test:admin --integration
# Includes synthetic browser flow, keyboard, themes, axe and secret clearing:
pnpm test:admin --e2e
# Real SSO is separately opt-in with the existing Keycloak fixture:
E2E_KEYCLOAK=1 pnpm --filter @verbis/admin-web e2e --project keycloak
```

The runner never applies migrations and rejects unknown flags. Static checks are separate:

```sh
pnpm --filter @verbis/admin-web typecheck
pnpm --filter @verbis/admin-web build
pnpm --filter @verbis/api typecheck
pnpm --filter @verbis/api openapi:generate
```

See [ADR-0030](../../docs/adr/0030-admin-control-plane-and-privacy.md) for the new contract boundaries.
