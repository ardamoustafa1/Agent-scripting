# ADR-0006: Declarative JSON script model

- **Status:** Accepted · 2026-10-01
- **Related:** [SCRIPT_MODEL](../SCRIPT_MODEL.md), [ADR-0007](0007-safe-expression-engine.md), [DOMAIN ScriptVersion](../DOMAIN.md)

## Context
Scripts must be designable visually, diffable, collaboratively editable, versioned, migratable, secure to execute, and portable between designer and runtime.

## Decision
A script version is a **pure-data JSON document** (`schemaVersion`, `meta`, `i18n`, `variables`, `dataSources`, `pages` with layout trees, `rules`, `flows`, `theme`, `componentRegistry`) validated by a shared zod schema. The runtime is a deterministic **interpreter**; no generated or evaluated code. Layout trees are built on three core primitives (`box`, `button`, `webService`); higher components are compositions or SDK-registered. Events map to a **closed set of typed actions**. Nodes have stable kebab-case ids. Documents are canonicalized (sorted keys, positions excluded) for checksum and diff. Published versions are immutable. `schemaVersion` changes use migrators; breaking format changes require an ADR.

## Consequences
- (+) Safe by construction, diffable (id-keyed tree diff), CRDT-friendly, testable, AI-generatable and schema-validated.
- (+) Same document drives designer, runtime, debugger, analytics.
- (−) Expressiveness bounded by the action/component set → SDK and new actions via releases.
- (−) Large documents need limits (size/nodes/depth) and efficient diff/CRDT handling.

## Alternatives
- Embedded JS snippets: powerful but unsafe and undiffable. Rejected.
- Generated React code per script: build pipeline, security and versioning burden.
- Proprietary binary/XML formats: poor tooling.
