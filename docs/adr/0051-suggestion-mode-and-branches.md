# ADR 0051 — Suggestion mode and script branches

Status: Accepted (suggestions C2 and branches C3 implemented) · 2026-10-07 · DIFFERENTIATORS C2, C3 (suggestions and branches are implemented)

## Context

Reviewers can only comment today; they cannot propose a change the owner applies in one step.
Teams also want a long-lived "November campaign" line of work merged back later.
`mergeDocuments` (`@verbis/script-schema`) and `POST /v1/scripts/:id/merge-preview` already merge
three existing versions by stable ids and report every conflict.

## Proposal

1. **Suggestions** are RFC 6902 patches against a pinned base version, stored per script in a
   `script_suggestions` table (tenant RLS, UUIDv7, `state` open/accepted/rejected/stale), created
   by a reviewer, applied by the owner as one transaction that creates a new draft version and
   writes `script.suggestion.accepted`. A suggestion whose base is no longer the head is `stale`
   and is rebased through `mergeDocuments` (conflicts shown, never auto-resolved).
2. **Branches** are a `branch` label on `script_versions` plus `parent_version_id`. A branch has
   its own draft head; publishing is still only from the mainline. **Merge** = `mergeDocuments`
   of (common ancestor, mainline head, branch head) → conflicts resolved in the visual diff →
   saved as a normal new mainline draft, so review, approval, SoD and publication gate apply
   unchanged. No branch can publish directly.
3. Yjs collaboration (ADR-0028) is untouched: a suggestion is data, not a live document.

## Decisions needed before implementation

- Migration for `script_versions` (nullable `branch`, `parent_version_id`) and the unique
  `(script_id, number)` interplay with per-branch numbering.
- Whether a suggestion may touch more than one page, and who may accept (owner only vs. any
  editor).
- UI: suggestion overlay on the canvas and a node-level conflict resolver.

## Consequences

No schema or API change until accepted. The merge preview can already be used by tooling to
combine two diverged versions by hand.

## Decision (2026-10-07): suggestions implemented, branches still open

Suggestions (part 1) are accepted and implemented with these choices for the open questions:

- **One suggestion may touch any number of pages** (up to 200 operations), because a reviewer's
  edit rarely stays inside one page. **Anyone who can read the script may propose; only users with
  `update` on the script may accept or reject.** The owner rule is not special-cased: it is the
  existing `update` ability, so SoD and ABAC apply unchanged.
- **Stale detection is by guard, not by rebase.** Instead of storing the base document, each
  operation records what it relied on (the value at a replaced/removed path, the absence of an
  added key, the length of an array receiving an item). The patch applies only if every guard
  still holds; otherwise it is reported as *stale* (derived at read time, never auto-resolved) and
  can only be closed. This is stricter than the `mergeDocuments` rebase in the proposal and needs
  no stored base; rebasing stale suggestions remains possible later through the merge.
- **Operations are independent.** The editor's suggestion mode (`suggestOperations`) compares
  objects key by key, arrays element by element only when identities and order are unchanged,
  appends as `add`, and replaces any other array change as a whole, so no operation depends on an
  index another operation shifts.
- **Accepting goes through the normal draft update** (`updateDraft`: lease, optimistic version,
  validation, projection, `script.version.updated`), then writes `script.suggestion.accepted`.
  Creation and rejection are audited as `script.suggestion.created` / `.rejected`; operation
  values are never copied into the audit event, only `op path`.
- Table `script_suggestions` (tenant RLS, no delete grant); routes under
  `/v1/scripts/:id/versions/:number/suggestions`.

## Decision (2026-10-07): branches implemented

- **A branch has exactly one working version.** `script_versions` gained `branch` (lower-case
  hyphenated name) and `parent_version_id`; a partial unique index allows one live version per
  `(script, branch)` and a check keeps both columns set or both null. Numbering stays global per
  script, so `(script_id, number)` is unchanged and no per-branch numbering is needed. A branch
  starts from a mainline version (a branch cannot start from a branch).
- **A branch can never be submitted or published** (`VERBIS_BRANCH_NOT_PUBLISHABLE` in `submit`),
  so every release still passes review, SoD and the publication gate as a mainline version.
- **Merge** = `mergeDocuments(parent version, current mainline head, branch version)`. With any
  conflict the merge is **refused** (`VERBIS_BRANCH_CONFLICT`, listing paths); the author resolves
  it in the branch and merges again. A clean merge creates a **new mainline draft** through the
  normal `createVersion` (validation, projection, `script.version.created`) plus
  `script.branch.merged`; the branch records `mergedIntoNumber` and cannot be merged twice.
  A visual per-node conflict resolver is not built.
- Routes: `GET/POST /v1/scripts/:id/branches`, `GET .../:name/merge-preview`,
  `POST .../:name/merge`. Branch creation needs `update` on the script; reading needs `read`.
