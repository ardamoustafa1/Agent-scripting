# ADR-0030 — Admin BFF workspace, constrained control plane and privacy generations

- Date: 2026-10-03
- Status: accepted for implementation; migration/integration/browser validation pending

## Context

Admin-web needs real tenant, identity, connector, security and governance operations. Runtime RLS
must remain scoped to the authenticated tenant. The app role must not become a cross-tenant database
reader. Secret values must not become query-cache or idempotent response records. Privacy changes
must not rewrite immutable audit/session-event chains or reuse old hot snapshots.

## Decision

Use existing BFF cookies, CSRF, CASL and versioned API contracts. Menu availability derives from
packed CASL rules, including inversions; every server endpoint still authorizes independently.
Pages are lazy modules, reuse the token UI library and have tenant/user query keys. Metadata can be
cached in memory; generated SCIM/TOTP credentials stay only in a transient component dialog. SCIM
issuance and break-glass enrollment opt out of generic response replay storage.

Platform tenant creation/state/quota/feature operations use fixed-search-path SECURITY DEFINER
functions, revoked from PUBLIC, callable only by verbis_app. Functions verify active user + active
platform tenant + system SuperAdmin assignment inside the current RLS tenant context. API adds SSO
principal verification. API-created tenants cannot set platform=true or inherit SuperAdmin. The
control-plane mutation and its audit append share the request transaction. Normal tenant CRUD and
privacy requests continue through FORCE RLS. No tenant selector changes the caller's session tenant.
Capacity allocation locks the tenant before counting new users, scripts or active runtime sessions.

Extend versioned tenant settings with brand, security.ipAllowlist, embedding, session, audit retention,
authz.separationOfDuties and a classification catalog. IP enforcement uses Fastify's already trusted
request IP; malformed policies deny, and saves that exclude the current admin reject. Brand values
are consumed by agent-web, using computed contrast through UiProvider.

Register public launch JWKS in the existing issuer table. Permit only public Ed25519/ES256 fields,
unique kids and valid coordinate/key imports; private key material never enters this API. Rotation
uses an explicit version update and operator-managed overlapping keys.

Privacy requests seal subject and reason with tenant/request-bound AAD, and audit only kind, identity
verification attestation and count. Synchronous search is deliberately bounded; active sessions and
legal hold prevent anonymization. Operational fields can be erased while immutable chains remain.
Redis state is evicted; runtime cache and local secure values are fenced by **both event sequence and
DB version**. Privacy increments DB version without inventing a session event or changing its chain
watermark. This also prevents another replica from serving a previous snapshot after administrative
changes. If Redis eviction fails, the database transaction fails; cache eviction before a rollback is
safe because PostgreSQL is authoritative.

OIDC discovery/SAML endpoint probes use existing SSRF-controlled identity egress. Metadata uploads
are bounded and reject entities/DTD; X509 signing certificates are validated. These probes do not
assert completion of authenticated SSO. Connector probes show actual supervisor state. Debug is a
redacted audit stream, not unfiltered vendor payloads.

## Consequences and follow-ups

Migration ownership/privileges, concurrency, real SSO, vendor connectivity, browser/a11y and privacy
cache invalidation need the authored opt-in tests; none were executed during implementation at the
user's request. The migration was not applied. Cross-tenant control functions remain deliberately
small and must stay reviewed when adding new operations.

Tenant registry pagination beyond 500, distributed secure-memory purge signaling, subject evidence
retention, complete DSAR across archives/CRM/analytics, and analytics retention worker enforcement
remain separate work. Classification catalog does not override authoritative script/integration
classification. Audit retention remains a minimum archival retention, not a purge command.
