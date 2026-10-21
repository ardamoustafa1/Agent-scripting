# ADR 0054 — Conditions on empty values do not hold; unanswered bindings keep their default

Status: Accepted · 2026-10-21 · Implemented after a live walk of the built-in templates in the designer preview. Amends the runtime behaviour described in [ADR-0007](0007-safe-expression-engine.md) without changing the engine.

## Context

The expression engine is strict by design: `<`, `>`, `<=`, `>=` throw `TYPE_COMPARISON` unless both
operands are numbers or both are strings, and arithmetic or text functions throw on other types.
A field the agent has not filled yet, and a data source that has not answered, hold `null`.

The no-code rule builder produces exactly such comparisons ("Monthly income ≥ 30 000",
"Credit score ≥ 650"). Before this ADR:

- a `visibleWhen`/`enabledWhen` reading an empty value threw inside the renderer, so the node fell
  into its error boundary and the agent saw "This component could not be displayed";
- a flow decision reading an unanswered data source failed the navigation;
- a one-way binding to data that had not arrived (`rows: ds.debtInfo.history`) failed the
  component's prop schema the same way.

Three of the four document templates hit at least one of these on a page their scenarios never
reached (credit card offer, telecom usage table and tariff list, collections payment history).

## Decision

1. **Runtime, not engine.** `RuntimeExpressions.condition` (`packages/core-runtime/src/expressions.ts`)
   returns `false` when evaluation throws `TYPE_COMPARISON`, `TYPE_NUMBER` or `TYPE_STRING` **and**
   at least one concrete path the expression reads (`vars.x`, `ds.source.field`) is `null` or
   missing. Every other error is rethrown unchanged, so a text compared with a number, an unknown
   function or a forbidden property still fails visibly. Dynamic reads (`vars.*`) never count as
   empty. The engine, rule JSON, `ruleToExpression` and assignment routing are unchanged.
2. **Consequences per use.** Hidden (`visibleWhen`), disabled (`enabledWhen`), not required
   (`requiredWhen`), the `conditional.else` branch, and a decision's default edge. All are the
   "condition does not hold yet" reading the rule builder already shows.
3. **Unanswered bindings.** A one-way binding whose evaluation fails only because a value it
   reads is empty (`formatCurrency(vars.premium)` before the premium is known) reads as `null`
   (`RuntimeExpressions.bindingValue`). When a binding is `null` and the resolved props fail the
   component schema, the renderer retries with the authored prop (or the component default) for
   those bindings only. A value that is present but wrong still fails the node.
4. **Tables.** A table row without the configured key column is identified by its position
   instead of failing the component, and a table whose rows are bound from elsewhere (a flow data
   source, a variable) shows no Run/Refresh controls of its own.
5. **Authoring feedback.** The designer reports an expression calling a function outside the
   allow-list, or with the wrong argument count, as a blocking `VERBIS_EXPRESSION` error in Script
   Health, and a card (`pci`) variable two-way bound to a plain field as `SENSITIVE_DATA_EXPOSED`
   (the renderer refuses it during the call). Both were previously silent until a call.

## Consequences

- Published scripts that previously failed on empty values now render or branch; scripts that
  worked are unaffected (only throwing evaluations change).
- A designer can no longer rely on an error to notice an always-empty value. Script Health, the
  preview timeline and scenarios remain the place to find it.
- Tests: `renderer.spec.tsx` (empty field vs real type error, unanswered binding),
  `template-pages.spec.tsx` (every page of every built-in template renders with the full component
  registry; the credit card sale completes end to end), `store-lifecycle.spec.ts` (authoring
  errors).

## Not decided here

Whether a completing `submitOutcome` should keep validating branch pages the call never visited
was left to the product owner; decided in
[ADR-0055](0055-completion-validates-the-call-that-happened.md): only the pages the call showed and
the mandatory pages are validated.
