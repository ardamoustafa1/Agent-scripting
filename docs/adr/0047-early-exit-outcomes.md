# ADR 0047 — Early-exit outcomes and the mandatory-page rule

Status: Accepted · 2026-10-07 · DIFFERENTIATORS Wave 2 follow-up (A6). Accepted together with the request to complete all waves; items 1, 2, 4 and 5 are implemented, item 3 is a follow-up.

## Context

`submitOutcome` (`packages/core-runtime/src/executor.ts`, case `submitOutcome`) refuses with
`VERBIS_MANDATORY_PAGE_UNVISITED` while any page marked `mandatory: true` is unvisited, and then
with `VERBIS_VALIDATION_FAILED` if whole-script validation reports any issue. An `end` flow node
with `outcome` runs `submitOutcome` (`runtime.ts`, case `end`). The rule is tested
(`runtime.spec.ts`) and listed among the runtime guards in PROGRESS, but no ADR defines it.

The rule is right for the completing path (a sale cannot be recorded without the KVKK notice or
the mandatory disclosure). It is wrong for legitimate early exits: could not verify identity,
wrong party, customer refused before the disclosure page, technical failure of a lookup. Those
paths never reach the mandatory pages, so they cannot carry an outcome at all. Writing scenarios
for the built-in templates (Wave 2, A6) exposed this: `credit-card-sales` `n-end-tech`
(`TECH_ERROR`) and `collections` `n-end-wrong-party` (`WRONG_PARTY`) were unreachable as
outcomes. As a workaround their `outcome` was removed; the agent records the result in wrap-up
(wrong party already sets a disposition). Analytics therefore loses these outcomes.

Changing what `submitOutcome` accepts changes the runtime contract of every published script, so
it needs an ADR (CLAUDE.md §1.9).

## Decision (proposed)

1. **Explicit, author-declared early exit.** `submitOutcome` and the `end` flow node gain an
   optional `completion: "complete" | "early"` (default `"complete"`). Omission keeps today's
   behavior byte-for-byte, so existing documents and published versions are unaffected. This is an
   additive schema 1.x field; the document `schemaVersion` minor is bumped and the migration is a
   no-op.
2. **`early` relaxes only completeness, never safety.**
   - The mandatory-page check is skipped.
   - Whole-script validation is replaced by validation of **visited** pages only (a value the agent
     did enter must still be valid; pages never shown are not demanded).
   - Sink rules are unchanged: `assertSink` still applies, `pci` values remain forbidden in
     `notes`, and server-side outcome validation (tenant outcome catalog, writer fencing, ADR-0039)
     is unchanged.
3. **Recorded and visible** *(follow-up, not implemented)*. The outcome command already carries
   the whole action, including `completion`, but the runtime session event, the analytics fact and
   the outcome audit metadata do not yet record it, so analytics cannot yet separate early exits.
4. **Authoring guidance (implemented).** `completionBypasses()` in `@verbis/script-schema` finds
   every `end` node with an `outcome` that is not `early` and is reachable from the start without
   passing a mandatory page (conditions ignored, so it is conservative and never hides a bypass).
   The designer reports it as a blocking `flow` error, `VERBIS_LINT_COMPLETION_BYPASS`
   (`designer.preview.lintCompletionBypass`). The server template test applies it to every built-in
   template. A hint for an unnecessary `early` flag and the release-risk listing are not done.
5. **Templates (implemented).** `TECH_ERROR` (credit card), `WRONG_PARTY` (collections), `NO_SALE`
   and `ID_FAILED` (credit card) and `TRANSFERRED` (telecom) are `early`, with scenarios asserting the
   outcome where a scenario reaches them. The new check found that the credit-card `NO_SALE` /
   `ID_FAILED` and telecom `TRANSFERRED` endings could never have been recorded before this ADR.

## Alternatives considered

- **Classify outcome codes in the tenant catalog** (e.g. `category: non-contact`). Rejected as the
  only mechanism: the runtime evaluates documents without the tenant catalog (preview, regression,
  offline package), and the same code can be early in one script and complete in another.
- **Drop the rule.** Rejected: it is a compliance control (mandatory disclosure before sale).
- **Keep the workaround.** Loses outcome analytics for the paths supervisors most need to see.

## Consequences

- Additive schema change (`completion` is optional); existing documents and published versions
  behave exactly as before. The generated JSON schema is regenerated.
- The server never re-checked the mandatory-page rule (it lives in the runtime), so no server
  contract changes. The relaxation applies only where the author wrote `early`; a script that
  never uses it keeps the strict behaviour.
- Tests: executor (early skips the mandatory check, validates only visited pages, keeps rejecting an
  invalid entered value, a completing outcome still validates all pages, an `end` node carries
  its completion), `completionBypasses`, the lint rule, every built-in template.
