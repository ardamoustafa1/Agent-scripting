# ADR-0001: Monorepo with pnpm workspaces + Turborepo

- **Status:** Accepted · 2026-10-01
- **Related:** [ARCHITECTURE](../ARCHITECTURE.md), [CLAUDE.md §3](../../CLAUDE.md)

## Context
Verbis has ~10 deployable apps and many shared packages (zod schemas, primitives, SDKs). Frontend and backend must share script-model schemas and error types without version drift.

## Decision
Single repository: **pnpm workspaces** for dependency management, **Turborepo** for task orchestration and remote caching. TypeScript `strict` everywhere with project references/shared base configs in `@verbis/config`. Module boundaries enforced via lint rules (apps never import apps; `components → core-primitives → schemas`). Changesets/Conventional Commits for versioning of publishable packages (`component-sdk`, `connector-sdk`).

## Consequences
- (+) Atomic cross-cutting changes, one CI, shared tooling, single source of truth for schemas.
- (+) Fast incremental builds via caching.
- (−) Repo growth; requires disciplined boundaries and CODEOWNERS.
- (−) CI must be affected-only (Turbo filters) to stay fast.

## Alternatives
- Polyrepo: schema drift, release coordination cost. Rejected.
- Nx: capable, but heavier; team preference for pnpm+Turbo simplicity.
