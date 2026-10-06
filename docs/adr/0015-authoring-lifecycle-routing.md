# ADR-0015: Authoring lifecycle, shared screens, .verbis packages and the ScriptResolver

- **Status:** Accepted · 2026-10-01
- **Amends:** DOMAIN §5 (adds `approved`), ADR-0011 (assignment shape), DOMAIN Assignment (condition model)
- **Related:** [DOMAIN](../DOMAIN.md), [ADR-0013](0013-casl-authorization.md) (SoD), [ADR-0014](0014-audit-v2.md), [PROGRESS](../PROGRESS.md) steps 14–15

## Decision

### Versions
- States `draft → in_review → approved → published → retired` (+ `in_review → draft` on withdraw/reject, `approved → draft` on reopen). Transitions are optimistic (`WHERE state = <from>`) under a row lock, audited (`script.version.<event>`) and published (`verbis.scripts.version.<event>.v1`).
- Content changes only in `draft`. A `script_versions_guard` trigger enforces it in the database too (content/semver frozen outside draft, published only → retired, retired final, no hard delete).
- SemVer 2.0.0 (no build metadata) set on submit, strictly greater than every semver of the script, unique per script; a change note is required.

### Approval
- Policy = script override (`scripts.approval_policy`) → tenant default (`settings.authoring.approval`) → strict default (1 approval). Fields: `requiredApprovals`, `approverUserIds`, `approverRoles`, `rejectionReturnsToDraft`. Malformed policies fall back to the strict default.
- Reviews (`approved | rejected (reason required) | commented`) are append-only and belong to a **review round** that increments on every submit, so old votes never count for a resubmission. One vote per reviewer per round.
- SoD (tenant setting, ADR-0013): authors (creator, last editor, submitter) can neither approve nor publish — enforced by the CASL rule and again by the policy check.

### Shared screens
- `shared_screens` + immutable, semver'd `shared_screen_versions` holding a fragment (pages + variables + data sources + messages). A script version uses one `linked` (pages owned by the shared screen, re-materialized from the pinned version on every save) or `detached` (copied once; provenance kept). Composition is deterministic; differing variables/data sources/linked translations or two screens claiming one page are 422 conflicts.
- `script_screen_links` makes impact analysis a query: publishing a shared-screen version returns the affected script versions (`resave_draft` vs `new_script_version`).

### Packages (.verbis)
- One JSON file: `manifest` (package id, source/target environments, items with semver + checksum), `payload` (scripts, shared screens), `checksums.payload`, Ed25519 `signature` over canonical `{format, manifest, checksums}`. Import verifies trusted key → signature → payload checksum → manifest/payload consistency → every document checksum → schema validation, then creates **draft** versions (target approval applies) with provenance in `script_versions.source`. Only approved/published versions export. Keys: `PACKAGE_SIGNING_JWK` (this environment), `PACKAGE_TRUSTED_JWKS` (accepted sources).

### Templates
- Tenant templates (`templates`, from a script version) plus a built-in, release-versioned catalogue (fixtures). Instantiation creates a new script with a draft version.

### Campaigns
- `code` (unique, derived from the name if omitted), `locales`, `working_hours` (IANA zone, weekly intervals, holidays), `outcome_set`, and `campaign_external_mappings` (platform + kind + externalId, **unique per tenant** so one platform object routes to exactly one campaign).

### Assignments and the ScriptResolver
- Assignment: `versionPolicy` (`pinned` | `latestPublished`), `priority`, `effectiveFrom/To` (end exclusive), `conditions` {channels, locales (prefix match), queues, skills (any overlap), segments}, `expression` (no-code predicate, safe evaluator; `$expr` fails closed until the expression engine exists), A/B `variants` (basis points summing to 10000, optional per-arm version, sticky bucket = SHA-256(assignmentId:stickyKey)).
- Resolution is a pure function of (snapshot, context, time): campaign gates (active, window, channel) → per-assignment evaluation with reasons → total order **priority ↑, specificity ↓, effectiveFrom ↓, createdAt ↓, id ↑** → winner → variant. The decision returns a full trace (every candidate, reasons, facts read, ranking, tie and how it was broken) and is audited (`routing.script.resolved`, without attached data). Working hours are reported, never blocking.
- Cache: Redis snapshots per campaign keyed by a per-tenant generation, read before the database (so a snapshot is never cached under a newer generation); domain events (version/assignment/campaign) bump the generation after commit; TTL is a safety net; Redis failure falls back to the database.
- Conflicts: equal priority + overlapping context (every dimension intersects, windows overlap) → warning on create/update and `GET /v1/campaigns/{id}/assignment-conflicts`; `certain` without differing expressions, otherwise `possible`, with the runtime tie-breaker.

## Consequences
- New tables and columns in migration `20261001070000_authoring_routing`; enum value `approved`.
- `DELETE` on `script_versions` is revoked from the runtime role.
- Prompt-3 assignment fields (`validFrom`, `validTo`, `rule`) remain accepted as aliases.


Routing context, hours gating, predicate admission, cache freshness and session admission are refined by [ADR-0040](0040-authoritative-routing-and-session-admission.md).
