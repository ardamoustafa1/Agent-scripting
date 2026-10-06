# Verbis

Agent scripting platform for contact centers: multi-tenant, web-based and CTI-agnostic.
Read [CLAUDE.md](CLAUDE.md) (project rules) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.
Roadmap and status: [docs/PROGRESS.md](docs/PROGRESS.md).
TR/EN guides: [docs-site](apps/docs-site/README.md) (`pnpm docs:dev`, port 5176).
Sales demo: [3-minute walkthrough](docs/DEMO.md); provision an isolated local bundle with `pnpm seed:demo`.

## Local development setup

**Prerequisites:** Node.js ≥ 22.12 (24 recommended, see `.nvmrc`), pnpm 9 (`corepack enable`),
Docker with Compose v2.20+ and OpenSSL on `PATH`.

```bash
pnpm install --frozen-lockfile
pnpm dev:bootstrap
pnpm dev
```

- `pnpm install` creates a private `.env` with local defaults and internal/audit signing keys, and installs Git hooks. CI can skip this prepare step; explicit bootstrap also creates the environment.
- `pnpm dev:bootstrap` provisions a local mTLS CA, hub client and API edge certificate, independent integration/analytics keys, package signing and trusted JWKS. It starts the Compose stack, waits for PostgreSQL/Redis/NATS/Keycloak, builds the workspace, migrates and seeds `verbis-dev` with an active simulator and certificate-bound service client. `HUB_TENANTS` is configured from the seed. Generated material stays in ignored `.env` and `.dev/` (files `0600`, TLS directory `0700`).
- Repeating bootstrap preserves existing signing/encryption keys, certificates and seed IDs. Existing custom endpoints/keys are preserved. Bootstrap is restricted to development and loopback API/database/hub connections.
- `pnpm dev` runs the browser apps, API, connector hub, local mTLS edge and **audit worker** in watch mode. The worker uses `verbis_audit_worker` and signs checkpoints; the API uses `verbis_app`. The owner connection is used only for migrations/seeding.
- The first run pulls images and builds all packages; duration depends on the machine and network. `pnpm seed` also builds its workspace dependencies, so it works before a full application build.

### A second isolated stack or port conflicts

Set `COMPOSE_PROJECT_NAME` to a distinct name in `.env`, change only the `*_PORT` values, then run `pnpm dev:bootstrap`. Bootstrap derives connection URLs, browser origins and OIDC settings from those ports. Keycloak realm import uses the configured browser/API ports too. Later port edits refresh previously managed URLs; explicit custom URLs remain yours to maintain. Keycloak realm changes require a fresh realm import (use a new Compose project for a new isolated stack).

`pnpm test:bootstrap` verifies the same install → bootstrap → dev sequence in a disposable clean source copy, with distinct ports and volumes. It also checks standalone seed with missing generated/build prerequisites, repeated bootstrap, six health endpoints, real simulator mTLS, a valid signed checkpoint and Keycloak login/logout with axe. It removes only its generated Compose project and temp copy; logs and a safe summary are under `reports/bootstrap/`.

### What runs where

| App / service                 | URL                                 | Health                                      |
| ----------------------------- | ----------------------------------- | ------------------------------------------- |
| Designer (designer-web)       | http://localhost:5173               | `/health`                                   |
| Agent desktop (agent-web)     | http://localhost:5174               | `/health`                                   |
| Admin (admin-web)             | http://localhost:5175               | `/health`                                   |
| Core API (api)                | http://localhost:4000               | `/health/live`, `/health/ready`             |
| Connector hub                 | http://localhost:4100               | `/health`, `/health/live`, `/health/ready`  |
| Local mTLS API edge           | https://localhost:4443              | client certificate required                 |
| Audit worker                  | http://localhost:4200               | `/health/live`, `/health/ready`             |
| Keycloak (realm `verbis-dev`) | http://localhost:8080               | admin console `/admin`                      |
| MinIO console                 | http://localhost:9001               | S3 API on `:9000`                           |
| Mailpit                       | http://localhost:8025               | SMTP on `:1025`                             |
| Grafana                       | http://localhost:3000               | Prometheus + Jaeger datasources provisioned |
| Prometheus                    | http://localhost:9090               |                                             |
| Jaeger                        | http://localhost:16686              | OTLP via collector on `:4317/:4318`         |
| NATS (JetStream)              | `nats://localhost:4222`             | monitoring `http://localhost:8222`          |
| PostgreSQL 16 / Redis 7       | `localhost:5432` / `localhost:6379` |                                             |

The web apps proxy `/api/*` to the core API (dev and preview only). All ports bind to `127.0.0.1`.

### Dev users (Keycloak realm `verbis-dev`)

| User       | Group → role                           |
| ---------- | -------------------------------------- |
| `admin`    | `verbis-admins` → `tenant_admin`       |
| `designer` | `verbis-designers` → `script_designer` |
| `agent`    | `verbis-agents` → `agent`              |

Passwords come from `DEV_USER_*_PASSWORD` in your `.env` and are injected at realm import.
To change them after the first start, run `docker compose down -v` and start again. That command
**deletes all local data**.

### Signing in (SSO through the BFF)

`pnpm --filter @verbis/api seed` registers the dev Keycloak realm as an OIDC identity provider of
tenant `verbis-dev` (domain `verbis.test`, Keycloak groups → roles, JIT provisioning). Open
http://localhost:5175, enter `admin@verbis.test`, choose **Keycloak (dev)** and sign in. The browser
only ever holds the httpOnly `__Host-verbis_session` cookie; tokens stay in Redis, sealed.

- Realm changes (redirect URIs, back-channel logout URL) apply only to a fresh import: delete the
  `verbis-dev` realm in the Keycloak console (or `docker compose down -v`) and restart Keycloak.
- Keycloak SSO e2e: `E2E_KEYCLOAK=1 pnpm --filter @verbis/admin-web exec playwright test --project keycloak` (API on
  `:4000` and admin-web running, `DEV_USER_ADMIN_PASSWORD` in the environment).
- SCIM base URL: `http://localhost:4000/scim/v2/<tenant-slug>` with a token from
  `POST /v1/identity-providers/{id}/scim-tokens`. OAuth token endpoint for service clients:
  `POST /oauth2/<tenant-slug>/token`. Details: [ADR-0012](docs/adr/0012-identity-module.md).

## Everyday commands

| Command                                      | What it does                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:bootstrap`                         | Provision local mTLS, keys, infrastructure and idempotent simulator/service-client seed                                         |
| `pnpm test:bootstrap`                        | Verify the README setup in an isolated clean source copy                                                                        |
| `pnpm dev`                                   | Run all apps and audit worker (watch mode)                                                                                      |
| `pnpm build`                                 | Build everything (Turborepo, cached)                                                                                            |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates (same as CI)                                                                                                      |
| `pnpm e2e`                                   | Playwright + axe accessibility tests for the web apps (`pnpm --filter @verbis/agent-web exec playwright install chromium` once) |
| `pnpm format` / `pnpm format:check`          | Prettier                                                                                                                        |
| `pnpm db:migrate`                            | Apply Prisma migrations (`prisma migrate deploy`)                                                                               |
| `pnpm db:migrate:dev`                        | Create a new migration from schema changes                                                                                      |
| `pnpm seed`                                  | Idempotent dev seed (tenant `verbis-dev`, system roles, a dev admin); prints a `dev:token` command                              |
| `pnpm --filter @verbis/api dev:token`        | Mint a 5-minute internal JWT for local API calls (`curl -H "authorization: Bearer …" localhost:4000/v1/authz/me`)               |
| `pnpm --filter @verbis/api test:unit`        | API unit tests only (no Docker); `test:integration` runs the Testcontainers suites (PostgreSQL, Redis, NATS)                    |
| `pnpm --filter @verbis/api openapi:generate` | Regenerate `apps/api/openapi.json` (OpenAPI 3.1; a test fails on drift). Docs UI at `http://localhost:4000/api/docs` in dev     |
| `pnpm infra:up` / `pnpm infra:down`          | Start / stop the Docker stack                                                                                                   |

Run a command for one workspace with `pnpm --filter @verbis/<name> <script>`.

## Repository layout

See [CLAUDE.md §3](CLAUDE.md) and [ADR-0009](docs/adr/0009-workspace-layout.md).

```
apps/      api, connector-hub, designer-web, agent-web, admin-web
packages/  script-schema, expr, core-runtime, components, ui, sdk-connector, sdk-component,
           shared-types, i18n, test-utils, config-eslint, config-ts
infra/     docker (Dockerfiles, nginx), keycloak realm, postgres init, otel, prometheus, grafana
scripts/   env bootstrap, pre-commit secret scan
docs/      architecture, domain, script model, security, ADRs, progress
```

## Conventions (summary)

- TypeScript strict everywhere, ESM, zod at every boundary. Every service validates its env at startup
  and refuses to start with invalid config.
- Errors are RFC 7807 `application/problem+json`. UI text comes only from i18n keys (tr + en).
  WCAG 2.2 AA is enforced with axe in e2e.
- Commits follow Conventional Commits (commitlint). Pre-commit runs lint-staged and a secret scan
  (install [gitleaks](https://github.com/gitleaks/gitleaks) for full coverage).
- **Never commit secrets or `.env`.** `.env.example` holds placeholders for local development only.

## CI

`.github/workflows/ci.yml` runs install → format check → lint → typecheck → test → build, plus:
(`pnpm test` includes the API integration suites, which start PostgreSQL 16, Redis 7 and NATS JetStream
with Testcontainers, so the runner needs Docker; GitHub-hosted Ubuntu runners have it.)
e2e (Playwright + axe), a gitleaks secret scan, Docker image builds for all five apps with a Trivy
image scan, and a Trivy filesystem scan (dependencies, secrets, IaC). `.github/workflows/codeql.yml`
runs CodeQL. Renovate (`renovate.json`) keeps dependencies and images current.

## Troubleshooting

- **Port already in use:** change the port in `.env`. Every port is configurable.
- **`Invalid environment configuration`:** the message lists each bad variable. Compare with `.env.example`.
  Run `node scripts/ensure-env.mjs` to add variables that are new since your `.env` was created.
- **`DATABASE_APP_URL must use the least-privilege verbis_app role`:** run `pnpm db:migrate` (it creates
  the role and sets its password from `DATABASE_APP_PASSWORD`), and point `DATABASE_APP_URL` at `verbis_app`.
- **Keycloak unhealthy:** run `docker compose logs keycloak`. It needs Postgres to be healthy first.
- **MinIO image:** upstream MinIO stopped publishing images, so the stack uses `cgr.dev/chainguard/minio`.

Designer önizleme/debugger ve regresyon kullanımı: [docs/DESIGNER_PREVIEW.md](docs/DESIGNER_PREVIEW.md) · [ADR-0027](docs/adr/0027-preview-debugger-and-regression.md).

Agent desktop implementation, SSO/iframe setup and future test commands: [Agent desktop guide](docs/AGENT_DESKTOP.md).
