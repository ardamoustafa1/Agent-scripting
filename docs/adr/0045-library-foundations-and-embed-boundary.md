# ADR 0045 — Library foundations, form controls and embedded content

Status: Accepted · 2026-10-06 · M-01, M-02, M-23

Script authors retain the three public core primitives: Box, Button and WebService. Library components compose these primitives with accessible design-system controls. Form fields use `@verbis/ui` Input, Select, Checkbox, Toggle and related controls, with runtime bindings, validation, locale and cancellation supplied by the library's shared field adapter. Native field implementations outside that adapter are not a second script primitive.

`LibraryDefinition.builtOn` describes primitives rendered on every path, rather than a category-level promise. Every library renderer uses Box; every data renderer also uses WebService. `conditionalBuiltOn` records configuration-dependent Button controls (manual refresh, wizard navigation, signature clearing, timer start and configured actions). A disposition picker makes no Button claim. Rendering tests inspect actual Box and WebService elements for every library definition. Existing behavior tests exercise the conditional actions and field adapter. Passive text/list/table/SVG structure inside Box is permitted; it does not bypass runtime error containment or introduce a script-level primitive.

Image, video and iframe rendering share the core-runtime Embed boundary. It validates HTTPS, exact tenant-allowed origins and absent URL credentials; images use accessible alternatives, videos require captions, and frames use an explicit sandbox, no-referrer and denied device permissions. Ordinary frames have no script permissions. Hosted secure capture may allow scripts/forms/same-origin only on a distinct trusted origin, and messages must match both the configured origin and the actual frame window. The library keeps receipt schema validation, secure variables and redaction. Embed is an internal rendering foundation, not a fourth script node type. Media loading failures emit metadata without source content.

Data columns carry a validated ISO-style three-letter currency code, defaulting to TRY for compatibility. Formatting honors that column's currency and the runtime locale. The previous fixed-TRY formatter is removed.

Shared secure-input classification, API health polling, runtime datasource orchestration and marketplace adapter construction now have single implementations. Datasource HTTP execution remains outside the request transaction and session row lock; writer ownership is checked again before recording activity. The integration executor reuses its authorized decoded document rather than decoding it twice.

Verification: real library rendering contracts, EUR column formatting, media URL/sandbox/caption/message-source regressions, hosted privacy tests, runtime row-lock/writer tests, and existing marketplace contract tests.
