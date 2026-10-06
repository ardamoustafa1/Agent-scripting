# Verbis

Agent scripting platform for contact centers: multi-tenant, web-based and CTI-agnostic.
Read [CLAUDE.md](CLAUDE.md) (project rules) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.
Roadmap and status: [docs/PROGRESS.md](docs/PROGRESS.md).
TR/EN guides: [docs-site](apps/docs-site/README.md) (`pnpm docs:dev`, port 5176).
Sales demo: [3-minute walkthrough](docs/DEMO.md); provision an isolated local bundle with `pnpm seed:demo`.

## 5-minute setup

**Prerequisites:** Node.js ≥ 22.12 (24 recommended, see `.nvmrc`), pnpm 9 (`corepack enable`),
Docker with Compose v2.20+.

```bash
pnpm install
```

```bash
docker compose up -d
```

```bash
pnpm db:migrate && pnpm seed
```

```bash
pnpm dev
```

- `pnpm install` also creates `.env` from `.env.example` (dev-only values), adds variables introduced
  later to an existing `.env`, generates a local Ed25519 key pair for internal JWTs, and installs git hooks.
- `pnpm db:migrate` applies the migrations as the schema owner (`DATABASE_URL`) and enables login for
  the least-privilege runtime role `verbis_app`. The API connects only as that role (`DATABASE_APP_URL`)
  and refuses to start as a superuser, an owner, or a role that bypasses Row-Level Security.
- `pnpm dev` builds the shared packages, then runs every app in watch mode.
- The first `docker compose up -d` pulls images and Keycloak needs ~30–60 s to become healthy.
  Check with `docker compose ps`.

### What runs where

| App / service                 | URL                                 | Health                                      |
| ----------------------------- | ----------------------------------- | ------------------------------------------- |
| Designer (designer-web)       | http://localhost:5173               | `/health`                                   |
| Agent desktop (agent-web)     | http://localhost:5174               | `/health`                                   |
| Admin (admin-web)             | http://localhost:5175               | `/health`                                   |
| Core API (api)                | http://localhost:4000               | `/health/live`, `/health/ready`             |
| Connector hub                 | http://localhost:4100               | `/health/live`, `/health/ready`             |
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

| User       | Group → role                     |
| ---------- | -------------------------------- |
| `admin`    | `verbis-admins` → `tenant_admin` |
| `designer` | `verbis-designers` → `designer`  |
| `agent`    | `verbis-agents` → `agent`        |

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
- Keycloak SSO e2e: `E2E_KEYCLOAK=1 pnpm --filter @verbis/admin-web e2e --project keycloak` (API on
  `:4000` and admin-web running, `DEV_USER_ADMIN_PASSWORD` in the environment).
- SCIM base URL: `http://localhost:4000/scim/v2/<tenant-slug>` with a token from
  `POST /v1/identity-providers/{id}/scim-tokens`. OAuth token endpoint for service clients:
  `POST /oauth2/<tenant-slug>/token`. Details: [ADR-0012](docs/adr/0012-identity-module.md).

## Everyday commands

| Command                                      | What it does                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                   | Run all apps (watch mode)                                                                                                       |
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
