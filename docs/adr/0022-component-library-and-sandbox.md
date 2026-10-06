# ADR-0022: Shared screen catalog and reviewed component bundles

- Status: Accepted · 2026-10-02
- Related: ADR-0006, ADR-0007, CLAUDE.md §3/9; PROGRESS step 27

## Decision

`@verbis/components` registers the full screen catalog into the existing core-runtime registry. Designer preview and agent runtime share renderers, strict props schemas, events, bindable props, property metadata and validation. Core-runtime remains independent of the catalog/SDK. Additive optional registry hooks support template dependencies, custom validation, owned children (Repeater) and trusted write-only fields; existing definitions remain valid.

Screen composition uses Box, Button and WebService. The UI package owns tokens and accessible controls. Rich text is structured JSON with React-escaped interpolation; no HTML/code evaluation. Repeater identity is stable and row writes are immutable/scoped. Secure fields raise variable classifications and PAN values are dropped on runtime disposal.

Third-party executable code must be a publisher-reviewed, tenant-enabled standalone artifact. Host descriptors supply Zod schemas and metadata. Script manifests pin exact version and integrity. The authenticated catalog authorizes artifact URLs; streaming bounds and hash verification run before code enters a separate opaque iframe. A MessagePort exposes only explicit public prop/write/event capabilities. Private bindings, arbitrary actions and direct Runtime access are denied. Guest reload, approval expiry and failed refresh revoke access.

The SDK has an injected server enablement service whose adapter must persist entitlements and authoritative audit/outbox events in one tenant-scoped transaction. No new HTTP API or schema format version is introduced; built-in type additions and optional host hooks are backward compatible. Existing minimal registry/manifest exports remain compatible.

## Consequences

Partners bundle code/CSS as one module and cannot call arbitrary networks through the supplied sandbox CSP. Browsers and deployment CSP require integration verification. The iframe is not a CPU/memory quota or total hostile-publisher containment: only reviewed code and public props are eligible. Publishing, API persistence/authentication ports and entitlement subscriptions must be wired by the host application.

Storybook and unit/axe scenarios are supplied per registered type. At the user's explicit request tests are not executed during this task, so accessibility/coverage acceptance remains pending.
