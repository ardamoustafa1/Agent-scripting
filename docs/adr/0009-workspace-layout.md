# ADR-0009: Workspace layout and package names for the initial monorepo

- **Status:** Accepted · 2026-10-01
- **Amends:** [CLAUDE.md §3](../../CLAUDE.md) (repository layout), [ADR-0001](0001-monorepo.md)
- **Related:** [ARCHITECTURE](../ARCHITECTURE.md), [PROGRESS](../PROGRESS.md) step 1

## Context
Step 1 (monorepo scaffold) asked for a different app and package set than CLAUDE.md §3 listed in step 0.
The containers in ARCHITECTURE.md stay valid as **logical** boundaries. The question is how they map to
deployable workspaces at the start of the project.

## Decision

**Apps**

| Workspace | Hosts (ARCHITECTURE containers) | Notes |
|---|---|---|
| `apps/api` | core-api now; runtime-session, integration-engine, audit-service and analytics start as **NestJS modules** here | A modular monolith with strict module boundaries. Each module is extracted into its own deployable when load, isolation or compliance requires it (a new ADR each time). |
| `apps/connector-hub` | connector-hub | Separate from day one: adapters need isolation (ADR-0008). |
| `apps/designer-web`, `apps/agent-web`, `apps/admin-web` | the three SPAs | Vite + React. |
| api-gateway / BFF | — | Added in step 7 as `apps/api-gateway`. Until then nothing in the browser holds tokens. |
| `apps/docs-site` | — | Optional, deferred to the end of the roadmap. |

**Packages** (old name in CLAUDE.md §3 → new name)

| New | Replaces / role |
|---|---|
| `script-schema` | `schemas` (script-model part) |
| `expr` | `expression` |
| `core-runtime` | `core-primitives` |
| `components` | unchanged |
| `ui` | `design-system` |
| `sdk-connector` | `connector-sdk` |
| `sdk-component` | `component-sdk` |
| `shared-types` | cross-cutting zod schemas and types, env validation, RFC 7807 types (absorbs `errors` and the API/event part of `schemas` for now) |
| `config-eslint`, `config-ts` | `config` (split) |
| `i18n` | unchanged |
| `test-utils` | new: deterministic clock and id helpers |
| `audit-client` | deferred to step 6 |

The layering rule keeps the same meaning: `components → core-runtime → script-schema / expr`.
It is enforced by `no-restricted-imports` in each package's ESLint config.

## Consequences
- (+) Fewer deployables early on, so local development, CI and on-prem installs are simpler.
- (+) Module boundaries inside `apps/api` keep the later extraction mechanical.
- (−) The runtime, audit and integration modules share one process until extracted. Isolation-sensitive
  parts are extracted first: the integration-engine egress for the SSRF blast radius, and the audit
  sequencer.
- (−) The docs use container names, the code uses workspace names. The tables above are the mapping.

## Alternatives
- Scaffold all ten containers as separate apps now: too much overhead before any domain code exists.
- Keep the old package names: the step 1 request explicitly set the new names.
