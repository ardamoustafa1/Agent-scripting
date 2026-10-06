# ADR-0013: CASL authorization, system roles v2, ABAC scopes and separation of duties

- **Status:** Accepted · 2026-10-01
- **Amends:** [ADR-0011](0011-api-foundation.md) (permission evaluation, system role set)
- **Related:** [SECURITY §5.5](../SECURITY.md), [PROGRESS](../PROGRESS.md) step 10

## Context
Prompt 3 shipped a deny-by-default guard over `action:Subject` strings with seven system roles (`tenant_admin`, `designer`, `reviewer`, …). Step 10 needs CASL with ABAC (campaign/team/site scope, field-level PII), a custom-role permission matrix, separation of duties (SoD) and a way for the web apps to hide controls. The role set requested in prompt 5 replaces the old one, which is a breaking change to role names.

## Decision
- **Shared package `@verbis/authz`** (isomorphic, `@casl/ability` + zod): vocabulary (12 matrix resources × actions incl. `approve`, `reveal`, `export`, `execute`; platform subjects `Tenant`, `BreakGlassAccount`, `Outbox`, `ApiDocs`), the 11 system roles as rule data, matrix ⇄ rules, rule resolution, SoD rules, PII redaction, rule (de)serialization and a React `AbilityProvider`/`<Can>`/`useCan` (subpath `@verbis/authz/react`).
- **Rules as data, no code.** Conditions are mongo-style with an operator allow-list (`$eq $ne $in $nin $all $exists $elemMatch`) and whole-string placeholders only (`${user.id}`, `${scope.campaignIds|teamIds|siteIds}`). No expression syntax is interpreted (CLAUDE.md §1.10).
- **Scope belongs to the assignment.** `user_roles.scope` (`{campaignIds?, teamIds?, siteIds?}`, ids or `"*"`) is substituted per grant, so a Designer for A plus an Approver for B never yields "approve A". Missing scope ⇒ empty set (deny). `"*"` removes the condition on allow rules; an inverted rule that would resolve to "any" is dropped rather than widened.
- **System roles live in code** (`roles.name` = key, `is_system = true`); their stored `permissions` are ignored. Custom roles store `roles.rules` (validated at the edge, fail-closed on read). Legacy permission strings on non-system roles and service-client scopes still translate 1:1 (`legacy.ts`), so existing data and `@RequirePermissions` keep working.
- **`super_admin`** counts only when the tenant has `settings.platform = true`.
- **SoD**: tenant setting `settings.authz.separationOfDuties` (default **on**, fail-safe on malformed settings) appends inverted `approve`/`publish` rules on `Script` where `authorIds` contains the caller; inverted rules come last so they beat every grant, including `manage all`. The use case passes `authorIds` (`authorIdsOf(version)`) and receives `VERBIS_AUTHZ_SOD_VIOLATION`.
- **Field level**: `PII_FIELDS` per subject; reading never implies seeing PII; `reveal` on the field is required (`AuthzService.redact`).
- **Enforcement**: `AccessGuard` builds the ability per request and checks `@Can(action, Subject)` (stackable) / legacy requirements at type level; unknown requirements deny. Instance-level checks happen in use cases with `AuthzService.authorize(action, asSubject(type, record))`.
- **Custom roles**: `/v1/authz/roles` (create/replace matrix with If-Match), `/v1/authz/users/{id}/role-scope`, `/v1/authz/vocabulary`. A granter may only grant what they hold (`VERBIS_AUTHZ_PRIVILEGE_ESCALATION`). Every change is audited (`authz.role.created|updated`, `authz.roleAssignment.scopeChanged`) with outbox events `verbis.authz.*.v1`.
- **UI**: `GET /v1/me/permissions` returns packed CASL rules (already resolved: no placeholders, SoD applied); the UI gates controls with `abilityFromSerialized` + `<Can>`. This is UX only; the API re-checks everything.

## Consequences
- Role names change: `designer → script_designer`, `reviewer → script_approver`, `auditor → security_auditor`, `integration_admin → integration_engineer`. Seeded dev tenants keep old rows (legacy permissions still resolve); IdP claim mappings must use the new keys.
- Migration `20261001050000_authz_casl` adds `roles.rules` and `user_roles.scope` (JSONB with type CHECKs).
- Claim-/SCIM-sourced assignments get an empty scope; scoped roles granted that way do nothing until an admin scopes them (follow-up: scope from claims).
