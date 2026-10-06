# ADR-0023: Permission-aware Studio shell and deployment switching

- Status: Accepted · 2026-10-02
- Related: ADR-0004, ADR-0013, ADR-0022; PROGRESS step 26

## Decision

The designer shell consumes the existing cookie BFF, `/v1/me/permissions` packed CASL rules and authoring APIs. It uses the shared UI design system and TR/EN catalogs. React Router authoring routes use literal lazy page imports, Suspense and isolated error boundaries. Authoring resource identifiers in paths do not create agent runtime sessions.

TanStack Query scopes resource caches by tenant, user, BFF session and deployment. Mutations require CSRF and per-payload idempotency keys; the existing API owns authorization and authoritative audit/outbox. Browser permissions only gate presentation.

Environment selection is navigation to administrator-configured deployment roots, each with independent authenticated infrastructure. Missing environment URLs remain disabled. Tenant identity never comes from UI parameters: organization changes use sign-out and another authorized SSO session until a membership switching API exists.

OpenAPI declarations are generated automatically; an AST transform maps recursive JSON to a direct alias for TS6 compatibility. Runtime Zod parsing does not rely on compile-time declarations. Bundle analysis is opt-in and produces a static report.

## Consequences

Existing APIs do not expose resource ownership, notification feeds or a global approval inbox. The shell presents unspecified ownership and empty notifications, uses real version states per script and documents those boundaries rather than fabricating data. These server/read-model additions and the visual canvas are subsequent work. This change is additive and introduces no API/schema version break.

Tests and axe scenarios are written but remain unexecuted per the user's explicit instruction.
