# @verbis/expr

A browser/Node expression language with an handwritten Pratt parser and a bounded AST interpreter. Source text is never compiled into JavaScript. No host functions, methods, globals, assignment, statements, constructors, or dynamic imports are available to expressions.

```ts
import {
  evaluate,
  compileExpression,
  analyzeExpression,
  renderTemplate,
  evaluateRule,
} from '@verbis/expr';

const context = {
  session: { customer: { name: 'Fixture' } },
  vars: { discount: 10 },
  offer: { amount: 100 },
};
const options = { now: () => 1790856000000, locale: 'tr' as const };
evaluate('session.customer?.name ?? "Unknown"', context, options);
evaluate('vars.discount > 0 ? offer.amount - vars.discount : offer.amount', context, options);
compileExpression('vars.discount * 2', options).evaluate(context);
renderTemplate(
  'Merhaba {{session.customer.name}}, {{formatCurrency(offer.amount)}}',
  context,
  options,
);
evaluateRule({ all: [{ fact: 'vars.discount', op: 'gte', value: 10 }] }, context, options);
analyzeExpression('vars.discount + 1', {
  vars: { type: 'object', properties: { discount: { type: 'number' } } },
});
```

## Language and semantics

- JSON-style values, single/double quoted escaped strings, finite numbers, arrays/objects, own-property dot/index access and `.length` on arrays/strings.
- Arithmetic `+ - * / % **`, comparison `< <= > >=`, strict structural equality `== === != !==`, `in` for array membership, `! && ||`, ternary and `??`. Arithmetic does not coerce strings to numbers; `+` concatenates only two strings. Division by zero and non-finite results produce typed errors.
- Contexts contain data only. Frozen null-prototype copies prevent mutation and inherited-property access. Getters, functions, class instances, sparse arrays and forbidden prototype keys are rejected. Missing properties/undefined context values become `null`; missing root identifiers are errors. `?.` skips access and computed-key evaluation when its object is null; use it on each potentially null hop.
- Calls target the trusted allowlisted registry by name; `object.method()` and returned-function calls are prohibited. Single-parameter lambdas `x => x.amount > 100` are accepted only in built-in collection argument slots. Lambda variables shadow context variables within their body and cannot escape.
- `if(condition, yes, no)`, `switch(value, case, result, ..., default)`, logical operators and ternary evaluate only the selected branches.
- `now()` is captured once per evaluation/template. Inject milliseconds since epoch. Without injection it returns the deterministic Unix epoch, never the machine's current time. Dates require ISO date-only or explicit `Z` UTC timestamps. All calendar arithmetic uses UTC. Currency output uses fixed TR/EN separators and symbol rules rather than host ICU, timezone or browser locale; defaults are `tr` and `TRY`.

## Registry

| Family             | Functions                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Text               | `upper`, `lower`, `trim`, `contains`, `startsWith`, `format`, `mask`, `padStart`                       |
| Numeric            | `round`, `formatCurrency(value, locale?, currency?)`                                                   |
| Dates              | `now`, `addDays`, `diff(a,b,unit?)`, `formatDate`, `isBusinessDay(date, holidays?)`, `age(birth, at?)` |
| Collections        | `count`, `sum(array, selector?)`, `filter`, `map`, `find`, `any`, `all`                                |
| Validation         | `isEmail`, `isPhoneTR`, `isTCKN`, `isIBAN`, `isVKN`, `luhn`, `regexTest(text, pattern, flags?)`        |
| Control/conversion | `if`, `switch`, `exists`, `between`, `before`, `after`, `toNumber`, `toString`, `parseJSON`            |

`format("Hello {0}", value)` uses indexed placeholders. `mask(value, visible = 4, character = "*")` hides the leading portion. `formatDate` replaces `yyyy MM dd HH mm ss`; its default is `yyyy-MM-dd`. `diff` defaults to days and supports milliseconds/seconds/minutes/hours/days. Holidays are explicit ISO dates; country-specific calendars are supplied by callers. Validators check syntax/checksum only; they do not verify a real identity/account/phone. IBAN uses explicit supported-country lengths and mod-97; unknown countries fail closed. RE2JS runs user patterns in linear time; lookaround/backreference behavior follows RE2 and unsupported constructs produce `REGEX_INVALID`.

`createDefaultRegistry().register(...)` extends the allowlist with typed parameter/return metadata and a trusted pure implementation. Context data cannot register functions. Custom implementations must be synchronous, perform no I/O and cooperate with `context.budget`; the sandbox does not isolate intentionally malicious host extension code.

## Budgets and error handling

Platform ceilings: 2,000 source characters, depth 32, 10,000 steps, 16,384 string characters, 1,000 elements/properties per container, 64 KiB UTF-8 output, 50 ms elapsed time. Overrides can only tighten ceilings. Parsing, context copies, nested lambdas, equality and output validation are bounded. Templates allow at most 32 placeholders and share a single time/step/output budget. Regex patterns are limited to 256 characters; flags are `i`, `m`, `s` without duplicates. `padStart` rejects excessive sizes before allocation.

`evaluate` throws `ExpressionError` containing a stable code and source position; `tryEvaluate` returns `{ ok, value }` or `{ ok: false, error: { code, position } }` without source values or host error details. Callers should map errors to their RFC 7807 boundary and record the runtime SessionEvent; this pure library performs no logging, auditing or domain mutations. `budgetClock` may be injected for deterministic timeout tests; it does not affect date functions.

## Designer and no-code rules

`analyzeExpression` returns AST, inferred type, complete dependent paths and diagnostics (`UNKNOWN_IDENTIFIER`, `UNKNOWN_PROPERTY`, `TYPE_MISMATCH`, etc.). Dynamic indexes include a wildcard dependency and index-expression dependencies. Lambda locals are excluded. `ContextSchema`/`SchemaFieldSchema` describe object/array item types; `completions(schema, prefix)` returns variable and function suggestions. Unknown/heterogeneous branches infer `unknown`; this is conservative inference rather than a full TypeScript checker.

`RuleSchema` accepts existing `{ all }`, `{ any }`, `{ not }`, `{ fact, op, value }`, `{ $expr }` trees and `{ operator: "AND" | "OR", conditions }` groups. The supported leaves match script-schema's rule vocabulary. `ruleToExpression`/`expressionToRule` convert both ways. Builder-representable operators are converted to canonical trees; other valid expression strings are preserved as `$expr` leaves, so a round trip preserves behavior without pretending every expression has a no-code leaf representation. Rule input is bounded before recursive schema validation.

## Tests (written; not executed)

```sh
pnpm --filter @verbis/expr test:unit
pnpm --filter @verbis/expr test:fuzz
pnpm --filter @verbis/expr test
```

Vitest suites cover grammar, every built-in, short-circuiting, registry extensions, context isolation, security budgets, prototype/global/statement attack corpora, ReDoS patterns, designer inference/dependencies, escaped templates and rule conversions. Fast-check uses a fixed seed and 1,000 cases per property. Shared conformance vectors are platform-neutral. Coverage gates are 98% lines/functions/statements and 95% branches; actual coverage is unverified until the tests are run. This package imports no Node-only runtime modules and does not use local timezone or Intl-based date/currency formatting.
