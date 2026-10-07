# ADR 0051 — Suggestion mode and script branches

Status: Proposed · 2026-10-07 · DIFFERENTIATORS C2, C3 (the pure three-way merge and a merge preview endpoint exist; persistence and UI do not)

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
