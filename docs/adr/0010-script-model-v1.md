# ADR-0010: Script document model v1 (concrete shape of `@verbis/script-schema`)

- **Status:** Accepted · 2026-10-01
- **Amends:** [ADR-0006](0006-json-script-model.md) (principles unchanged), [SCRIPT_MODEL](../SCRIPT_MODEL.md) draft v1
- **Related:** [ADR-0007](0007-safe-expression-engine.md), [DOMAIN Variable](../DOMAIN.md), [PROGRESS](../PROGRESS.md) step 2/12

## Context
Step 2 asked for a concrete `@verbis/script-schema` package with zod schemas, a JSON Schema export, a
semantic validator, migrations, tree helpers and fixtures. The step's specification is more detailed than
the SCRIPT_MODEL draft and differs from it in several places: action names, variable scopes, flow node
types, the binding format and the i18n shape. Frontend and backend both use this package as their only
source of truth, so the differences must be decided once and written down.

## Decision
`schemaVersion` **1.0.0** is defined by `@verbis/script-schema`. ADR-0006's principles (pure data,
closed action set, stable kebab-case ids, interpreter-only runtime, migrators) still hold. The shape is:

1. **Top level:** `{ schemaVersion, id (UUIDv7), meta, variables[], dataSources[], pages[], flow, subflows[], rules[], theme?, i18n, componentRegistry[] }`.
   There is one main `flow`, and `subflows[]` are the targets of `runSubflow` and `subflow` nodes.
   The flow's `start` node is the entry, so `meta.entryPage` is removed. `meta.locales` and `meta.defaultLocale` move into `i18n`.
2. **i18n:** `{ defaultLocale, messages: { [locale]: { [key]: string } } }`. Display text in props is
   always a `*Key` prop. The validator rejects literal `text/label/title/placeholder/…` props.
3. **Variables:** `{ key (camelCase), type, scope, default?, enumValues?, pii, classification, persist, source? }`.
   - `scope ∈ session | page | interaction | campaign | global`, where `global` is read-only.
   - `classification ∈ public | internal | pii | pci`. There is no `secret` class: secrets never become variables (CLAUDE.md rule 12).
   - The draft scope `screen` is renamed `page`.
4. **Identifiers addressable from expressions** use camelCase: variable `key` and data source `id`. This
   lets `vars.customerName` and `ds.customerLookup.score` parse without colliding with the `-` operator.
   All other ids (pages, nodes, rules, flows, timers, flow nodes and edges) stay kebab-case.
5. **Data sources:** `{ id, ref: "tenant-datasource:<key>", version, inputs: {name: Value}, outputs: {field: {path: JSONPath, variable?}}, policy }`.
   Protocol details and secrets stay in the integration module.
6. **Nodes:** `{ id, type, props, style, bindings[], events, visibleWhen, enabledWhen, requiredWhen, a11y, children? }`.
   - `style` is responsive (`base/sm/md/lg/xl`) and accepts **design tokens only**: no raw CSS, colors or lengths.
   - `bindings` is a list of `{prop, expression}` (one-way) or `{prop = "value", variable}` (two-way). This replaces the draft `$var/$ds/$i18n` value forms.
   - Conditions are `{$expr}` or `{$rule}`.
7. **Actions** are discriminated by `type`, not by the draft's `action` key. The closed v1 set has 22 actions:
   `setVariable, callDataSource, navigate, next, back, showToast, openModal, closeModal, validatePage,
   submitOutcome, setDisposition, writeBackToPlatform, transferHint, runSubflow, conditional, sequence,
   parallel, emitEvent, startTimer, stopTimer, maskField, logEvent`.
   - Renamed from the draft: `openDialog→openModal`, `closeDialog→closeModal`, `notify→showToast`, `runFlow→runSubflow`.
   - Not in v1: `runRules`, because rules are reactive; `platformCommand`, whose job is split across `writeBackToPlatform`, `setDisposition` and `transferHint`; and `copyToClipboard`/`focus`, which are left for a later minor version.
   - `openModal` opens a page in a dialog.
8. **Flows:**
   - Node types are `page | decision | dataSource | setVariable | subflow | end`. The draft's `trigger/condition/action/wait/parallel/join` types are not in v1; step 28 may add them in a minor version with a migration.
   - Edges carry `when?`, `port? (success|error)`, `default?` and `maxIterations?`.
   - A cycle is an error unless one of its edges declares `maxIterations` (a bounded loop).
9. **Validation output:** `{ severity, path (RFC 6901 JSON Pointer), code (stable UPPER_SNAKE constant, e.g. `FLOW_CYCLE`), messageKey (script.validation.*), params? }`.
   - Messages live in `@verbis/i18n` (tr + en). zod's English text is never surfaced.
   - Only `error` severity blocks `ok`. Unreachable pages and nodes, dead ends, missing error edges, missing translations and PII-to-log are warnings.
10. **Migrations:**
    - `migrate(doc)` walks a forward-only registry of `{from, to, up}` steps and never mutates its input.
    - `0.9.0` is the SCRIPT_MODEL draft shape. `0.9.0 → 1.0.0` converts i18n, renames the scope and actions, and changes the discriminator from `action` to `type`.
11. **JSON Schema** is generated with zod 4's native `z.toJSONSchema` (draft 2020-12, input shape). We do not use
    `zod-to-json-schema`: v3.25 accepts zod 4 as a peer, but in our test it emitted an empty schema for zod 4 types. The schema is
    committed at `packages/script-schema/schema/script-document.schema.json`, and a spec fails on drift.
12. **Tree edits** (`insert/move/duplicate/remove/updateNode`) use immer and return the next frozen document plus
    RFC 6902 `patches` and `inversePatches`. These drive undo/redo and audit diffs.

## Consequences
- (+) One concrete, typed contract for designer, runtime and API. The validator catches broken references,
  cycles, unreachable pages, PCI persistence and leaks, readonly writes and missing translations before publish.
- (+) Token-only styling and the closed action set keep the document free of injection vectors.
- (−) The draft examples in SCRIPT_MODEL no longer parse directly. They load through the 0.9.0 migration.
- (−) Expression references are found by a conservative scanner until the step-13 parser provides AST references.
- (−) Some draft actions and flow node types are deferred and will need minor versions and migrations.

## Alternatives
- Keep the draft shapes. Rejected because the step-2 specification is the newer requirement and the draft had no code depending on it.
- Accept both shapes at parse time. Rejected because it doubles every consumer's work. Migration at load time is enough.
