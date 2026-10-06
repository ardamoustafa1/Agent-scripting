---
title: "Rules and expression language"
---

## A data language, not JavaScript

Runtime supplies the context roots. Expressions contain no code, tokens or secrets. Use pure
expressions such as `vars.limit > 0 ? formatCurrency(vars.limit, "en", "TRY") : "—"`. Missing properties become
`null`; missing root identifiers are errors. Use `?.` at each nullable hop and `??` for defaults.

```text
vars.eligible && between(vars.score, [50,100])
session.customer?.segment ?? "standard"
sum(vars.items, item => item.amount)
```

Arithmetic uses numbers; `+` concatenates only two strings. Logical operations and `if`/`switch`
short-circuit. Single-parameter lambdas are accepted only by collection functions. See every
function with argument/type metadata and examples in [the reference](/en/designer/functions/).

## Builder rules

```json
{"all":[{"fact":"vars.eligible","op":"eq","value":true},{"fact":"vars.score","op":"gte","value":50}]}
```

Use AND/OR/NOT groups for separate decisions. Valid expressions beyond builder leaves remain
`$expr` leaves. A visibility rule is never an authorization control.

## Limits and errors

Maximum 2,000 source characters, depth 32, 10,000 steps, 50 ms, 1,000 elements per container and
64 KiB output. Overrides only tighten ceilings. Host injects `now()`; without it the Unix epoch is
used. Dates are ISO date-only or explicit UTC `Z`. Currency formatting has fixed TR/EN separators.
Regex uses RE2; avoid lookaround/backreferences. Validators check syntax/checksum, not a real
person or bank account. Provide an error branch.
