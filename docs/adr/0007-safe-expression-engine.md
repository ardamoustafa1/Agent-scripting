# ADR-0007: Safe expression engine — `eval` is forbidden

- **Status:** Accepted · 2026-10-01
- **Related:** [SCRIPT_MODEL §6](../SCRIPT_MODEL.md), [SECURITY §3 (T4)](../SECURITY.md), [CLAUDE.md rule 10](../../CLAUDE.md)

## Context
Bindings, rule leaves, input mappings and assignment rules need computed values. Tenants are semi-trusted; expressions run in the agent's browser and on the server (assignment, integration-engine mapping). Dynamic code execution would allow XSS escalation, data exfiltration, and DoS.

## Decision
Implement `@verbis/expression`: a small, **typed, CEL-like expression language** with a hand-written lexer/parser producing an AST, and a **tree-walking interpreter** (no `eval`, `Function`, `vm`, `with`, or dynamic import — enforced by lint and tests).
- Operands: literals, `vars.*`, `ds.*`, `interaction.*`, `agent.*`, `const.*`; operators: arithmetic, comparison, logical, ternary, `in`.
- **Function allow-list** (string, number, date, array helpers, safe regex with RE2-style linear-time engine or complexity cap). No property access outside the provided context; no prototype access (`__proto__`, `constructor`) — context objects are null-prototype frozen copies.
- **Budgets:** max expression length, AST depth, evaluation steps, output size, and wall-time; exceeding ⇒ deterministic error value + SessionEvent.
- Pure and side-effect free; no I/O, no time/random except injected clock.
- Static type-check at save/publish; unknown identifiers rejected.
- Same engine runs in browser and server (shared package) with identical semantics; conformance test vectors shared.
- Security tests: property-based/fuzz tests, prototype-pollution corpus, ReDoS corpus, budget exhaustion.
- Rule JSON (`all/any/not` trees) compiles to the same AST.

## Consequences
- (+) Eliminates arbitrary code execution; predictable, bounded, auditable logic.
- (−) Less expressive than JS; complex logic uses flows/actions or SDK components.
- (−) Maintaining a language (parser, docs, error messages, designer autocomplete).

## Alternatives
- `eval`/`new Function`: rejected outright.
- JS sandbox (vm2/isolated-vm/QuickJS): large attack surface, escape history; reconsidered only for server-side SDK components via ADR.
- JSONLogic/CEL libraries: evaluated; custom or vetted-library implementation must meet the budget/allow-list requirements above (decision in step 13 within this ADR's constraints).
