# ADR 0055 — A completing outcome validates the pages the call showed and every mandatory page

Status: Accepted · 2026-10-21 · Decided by the product owner. Partially supersedes decision 2 of [ADR-0047](0047-early-exit-outcomes.md) (whole-script validation for completing outcomes). Follows the open question in [ADR-0054](0054-conditions-on-empty-values.md).

## Context

`submitOutcome` without `completion: "early"` (and an `end` flow node with an `outcome`) first
requires every `mandatory` page to be visited, then ran **whole-script validation**: every field
of every page had to be valid, including pages on branches the call never took
(`ValidationEngine.script`).

In a branching script that rule makes completion impossible. A renewal script with an "accept"
branch (payment method required) and a "callback" branch (callback date required) can complete
neither: whichever branch the agent takes, the other branch's required field is empty. Authors
had to work around it with `requiredWhen` rules that repeat the branch condition, or leave fields
optional. The built-in collections and insurance templates do exactly that. The mandatory-page
rule already guarantees the compliance reason ADR-0047 gives for the check ("a sale cannot be
recorded without the KVKK notice or the mandatory disclosure"); validating unreached pages adds no
protection.

## Decision

1. **Scope.** A completing outcome validates the union of the pages the call **showed** and the
   **mandatory** pages (`ValidationEngine.completion`, used by the executor's `submitOutcome`).
   The mandatory-page visit check (`VERBIS_MANDATORY_PAGE_UNVISITED`) is unchanged and still runs
   first.
2. **What "showed" means.** A page counts once it was entered (`runtime.visited.<page>`, as
   before) or opened as a window with `openModal`, which now also sets `runtime.visited.<page>`. A
   window the agent filled in is part of the call; one never opened is not.
3. **Strictness on shown pages is unchanged.** Required values, unread `mustRead` notices and
   missing signatures on a shown page still block a completing outcome. Only the early exit
   (ADR-0047) relaxes those, as before.
4. **Unchanged:** sink rules, server-side outcome validation (tenant outcome catalog, writer
   fencing), the release gate, `completionBypasses` and the early-exit rules. The server
   validation hook now receives the shown and mandatory page ids instead of every page id.

## Consequences

- Published scripts: completion becomes possible where an unreached branch blocked it; a call
  that completed before still completes (fewer pages are checked, never more), except that a
  required field inside a window the agent opened is now checked, as it always was by
  whole-script validation.
- `requiredWhen` copies of branch conditions are no longer needed for completion; existing ones
  keep working.
- A page-scoped variable is cleared when the agent leaves its page, so a required field bound to
  one still fails completion once its page is behind the agent. Authors should bind required
  fields to session-scoped variables (the credit card template does).
- `ValidationEngine.script` remains for tooling (whole-document checks) and is no longer used to
  record outcomes.
- Tests: `runtime.spec.ts` ("completing outcomes validate the call that happened": unreached
  branch, shown page, opened window, mandatory page) and the template scenarios, which pass the
  publication gate unchanged.
