# CLAUDE.md — Verbis Project Constitution

Verbis is a multi-tenant, web-based **agent scripting platform for contact centers**. These rules apply to **every session, every prompt**. Read this file first; then read the docs it links.

Docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [DOMAIN](docs/DOMAIN.md) · [SCRIPT_MODEL](docs/SCRIPT_MODEL.md) · [SECURITY](docs/SECURITY.md) · [COMPETITIVE](docs/COMPETITIVE.md) · [PROGRESS](docs/PROGRESS.md) · [ADRs](docs/adr/)

## 1. Non-negotiable rules

1. **Tests with every change.** No code change merges without tests (unit; plus integration/e2e where behavior crosses a boundary). Bug fixes start with a failing regression test.
2. **Update `docs/PROGRESS.md` at the end of every prompt/session**: set the step status, add a dated note, list follow-ups. A prompt is not finished until this is done.
3. **Never commit secrets.** No keys, tokens, passwords, certificates, real customer data, or `.env` files. Use `.env.example`, Secret references (`secretRef`), and the secret store. Secret scanning runs in pre-commit and CI.
4. **Every domain change emits an audit event** (see §6). No state-changing use case without an `AuditEvent`.
5. **No hardcoded UI text.** All user-visible strings are i18n keys (`react-i18next`), with `tr` and `en` catalogs updated together. CI fails on missing keys.
6. **Accessibility is mandatory** (WCAG 2.2 AA): semantic HTML, keyboard operability, visible focus, contrast, ARIA only where native fails, reduced-motion respected, axe checks in Playwright.
7. **Public APIs are documented with OpenAPI** (generated from zod/Nest decorators; spec committed and diffed in CI).
8. **Errors use RFC 7807** `application/problem+json` everywhere (see §7).
9. **Breaking change ⇒ write an ADR** in `docs/adr/` (and bump API/schema version). Superseded ADRs are marked, never deleted.
10. **No `eval`, `new Function`, `vm`, dynamic `import()` of user input, or string-to-code of any kind.** User logic runs only in the sandboxed expression engine ([ADR-0007](docs/adr/0007-safe-expression-engine.md)).
11. **Script screens are never opened by URL parameters.** Only the secure launch flow ([SECURITY §4](docs/SECURITY.md)) creates a runtime session. Do not add routes that accept `campaignId`/`scriptId`/`userId`/`interactionId` from the query string to open a script.
12. **Secrets never reach the browser.** Web service credentials live in the Secret store; calls go through the server-side proxy ([ARCHITECTURE](docs/ARCHITECTURE.md#integration-engine)).

## 2. Stack (fixed; change only via ADR)

- Monorepo: pnpm workspaces + Turborepo. TypeScript `strict` everywhere (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Backend: NestJS (Fastify adapter), PostgreSQL 16, Prisma, Redis, NATS JetStream, BullMQ, MinIO/S3.
- Frontend: React 18 + Vite, TanStack Query, Zustand, dnd-kit, @xyflow/react, Radix UI + Tailwind + in-house design system, react-i18next.
- Identity: openid-client, @node-saml/node-saml, Keycloak in dev. BFF pattern; no tokens in the browser.
- AuthZ: CASL (RBAC + ABAC). Validation: zod shared schemas.
- Observability: OpenTelemetry, Prometheus, Grafana, pino.
- Test: Vitest, Playwright, k6, Testcontainers.

## 3. Repository layout

Workspace names follow [ADR-0009](docs/adr/0009-workspace-layout.md), which also maps them to the containers in ARCHITECTURE.md.

```
/apps
  /api                NestJS core API (modular monolith: core, runtime-session, integration, audit, analytics modules)
  /connector-hub      NestJS host for CTI/channel adapters
  /designer-web       Vite+React: visual + flow designer, rule builder
  /agent-web          Vite+React: agent desktop runtime renderer
  /admin-web          Vite+React: tenant/IdP/user/audit administration
  /api-gateway        (step 7) BFF + edge: sessions, CSRF, rate limit
  /docs-site          (optional, last)
/packages
  /script-schema      zod schemas for the script JSON model
  /expr               safe expression engine + rule evaluator (no eval)
  /collaboration      Yjs document bridge (ADR-0028), shared by Designer and API
  /core-runtime       Box, Button, WebService primitives: runtime contracts
  /components         screen components built ON core-runtime
  /ui                 design system: tokens, themes, accessible components
  /sdk-connector      adapter interfaces, contract test kit
  /sdk-component      third-party component SDK
  /shared-types       cross-cutting types/schemas, env validation, RFC 7807
  /i18n               catalogs (tr, en) and i18next setup
  /test-utils         deterministic test helpers (clock, ids)
  /config-eslint      shared ESLint flat config
  /config-ts          shared tsconfig bases
/infra                docker, keycloak realm, otel, prometheus, grafana (helm/terraform/k6 later)
/scripts              repo tooling (env bootstrap, secret scan)
/docs                 architecture, ADRs, progress
```

Dependency rules (enforced by ESLint `no-restricted-imports` per package + Turborepo):
- `apps/*` may depend on `packages/*`; **apps never import other apps**.
- `components` → `core-runtime` → `script-schema`/`expr`. Never the reverse.
- Connectors depend only on `sdk-connector` + `shared-types`/`script-schema`.
- Frontend code never imports Node-only or secret-handling code.

## 4. Code standards

- Small modules, explicit types at boundaries, no `any` (use `unknown` + zod parse). `@ts-expect-error` needs a reason and issue link.
- Validate **all** external input with zod at the edge; derive TS types from schemas (`z.infer`).
- Domain logic lives in framework-free service/domain classes; Nest controllers are thin.
- Every DB table carries `tenant_id`; PostgreSQL Row-Level Security is on; queries run inside a tenant-scoped transaction. Never trust a client-supplied tenant id.
- IDs are UUIDv7. Timestamps are UTC `timestamptz`, ISO-8601 on the wire.
- Money/PII/PAN fields are classified in the schema (`@pii`, `@pci`, `@secret`); logging and audit redaction is driven by these tags.
- No logging of PII, tokens, secrets, or full request bodies. Use pino redaction paths.
- Async work: idempotent handlers, outbox pattern for DB→NATS publication, retries with backoff + DLQ.
- Feature flags for incomplete features; no long-lived branches.
- Dependencies: pinned via lockfile, license-checked, `pnpm audit` and SBOM in CI.

## 5. Naming

- Files/dirs: `kebab-case`. Types/classes/components: `PascalCase`. Functions/vars: `camelCase`. Constants/env: `UPPER_SNAKE_CASE`.
- Packages: `@verbis/<name>`. DB: `snake_case` tables (plural), columns `snake_case`.
- REST: `/v1/<plural-resource>`, kebab-case paths, `camelCase` JSON. Events (NATS): `verbis.<context>.<aggregate>.<event>.v<N>` (e.g. `verbis.runtime.session.started.v1`).
- Audit actions: `<domain>.<entity>.<verb>` (e.g. `script.version.published`).
- i18n keys: `<app>.<feature>.<element>` (e.g. `designer.canvas.emptyState.title`).
- Script model ids: `kebab-case` stable ids (`btn-submit`), never positional.
- Conventional Commits. One logical change per commit.

## 6. Audit rules

- Every command that mutates domain state emits an `AuditEvent` **in the same transaction** (outbox) as the change.
- Required fields: `tenantId`, `actor` (user/service/connector), `action`, `target`, `outcome`, `correlationId`, `ip`, `userAgent`, `before/after` diff (redacted), `occurredAt`.
- Audit events are append-only and hash-chained ([DOMAIN](docs/DOMAIN.md#auditevent)). Never update/delete; no admin override.
- Read access to sensitive data (PII reveal, secret metadata, audit export) is audited too.

## 7. Error format (RFC 7807)

```
Content-Type: application/problem+json
{ "type": "https://errors.verbis.io/<slug>", "title": "...", "status": 4xx|5xx,
  "detail": "...", "instance": "/v1/...", "code": "VERBIS_<AREA>_<NAME>",
  "correlationId": "...", "errors": [ { "path": "...", "message": "..." } ] }
```
- Stable machine `code`; human `detail` is safe (no internals, no PII), localized via `Accept-Language` where useful.
- Problem types are catalogued in `@verbis/shared-types` (`problem.ts`) and documented in OpenAPI.

## 8. Testing

- Vitest unit tests co-located (`*.spec.ts`); Testcontainers for Postgres/Redis/NATS integration; Playwright for e2e + axe; k6 for load; contract tests for every connector (`sdk-connector` test kit).
- Coverage floor: 85% lines for `packages/*`, 75% for `apps/*`; security-critical modules (launch, authz, audit chain, SSRF guard, expression engine) require 95% + property/fuzz tests.
- Tests must be deterministic: inject clocks, ID generators, and randomness.

## 9. UI rules

- Use the design system only (`@verbis/ui`); no ad-hoc colors — design tokens only, light + dark themes.
- Every interactive component: keyboard path, focus ring, ARIA role/name, 24×24 min target (WCAG 2.2 2.5.8), no color-only meaning.
- Components in `packages/components` are built on `Box`, `Button`, `WebService` primitives (and compositions thereof), never raw DOM shortcuts that bypass them.
- Animations respect `prefers-reduced-motion`.

## 10. Definition of Done (per prompt)

- [ ] Code + tests green (`pnpm lint && pnpm typecheck && pnpm test`, plus `pnpm e2e` for UI changes)
- [ ] Audit events emitted for new domain mutations
- [ ] i18n keys added (tr + en), a11y checks pass
- [ ] OpenAPI updated; RFC 7807 errors used
- [ ] Docs/ADR updated if architecture or contracts changed
- [ ] `docs/PROGRESS.md` updated
- [ ] No secrets, no PII in logs/fixtures

## 11. Working agreement for Claude

- Read `docs/PROGRESS.md` to find the current step; do only that step's scope.
- If a request conflicts with this file, say so and propose an ADR instead of silently deviating.
- Prefer the smallest correct change; do not refactor unrelated code.
- Never weaken a security control to make a test pass.
