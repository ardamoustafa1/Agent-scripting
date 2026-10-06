# ADR-0025: Shared flow, condition and variable authoring

Date: 2026-10-02. Status: accepted. Script schema 1.1.0.

Designer adds lazy flow, rules and variables modes to the existing version editor. All modes
share EditorStore, atomic Immer history, CSRF/If-Match autosave and unsaved navigation guards.
React Flow handles graph interaction; ELK performs asynchronous layered layout. A layout only
commits if the document snapshot still matches its input. Drag positions are transient until drop.
Page double-click changes mode without discarding unsaved data.

The strict schema adds explicit Start and transfer-hint nodes, an optional End disposition, and
flow.designer groups/comments. Start is a passthrough. Transfer uses the existing audited action
executor and suggests a target. End sets disposition before submitting an optional outcome.
The forward-only 1.0.0 → 1.1.0 migration retains existing flow.start and node IDs. Existing 0.9.0
migration chains through both versions. Canvas coordinates, groups and notes are excluded from
semantic checksums; saved source JSON retains them. Older runtimes must upgrade before using
new node types; new drafts use 1.1.0.

Subflows remain embedded pure-data flows. Importing a readable script version copies its pages,
flows, rules and dependencies into the draft with fresh internal IDs. The copy is pinned at import
time and later edits to the source do not propagate. Dependency conflicts reject the import
atomically; authors resolve conflicting variables/data sources/translations/plugins before retrying.
The request uses the existing authorized BFF read endpoint. No runtime URL launch is introduced.

The no-code builder writes the shared Predicate union. AND/OR/not groups, typed facts and
operators convert through packages/expr. Expressions outside the representable subset remain
expression leaves. Empty and inclusive date ranges expand to ordinary predicates. Conditions
serve node visibility/enabled/required, Decision edges, script rules and assignment eligibility.
Assignment eligibility applies before existing weighted A/B variant selection; assignment changes
use the audited PATCH endpoint, CSRF and If-Match. Runtime permissions remain authoritative.

Variable reference discovery covers binding metadata, data-source outputs, action writes, flow
writes, rule facts, parsed expressions and script interpolation. Renaming edits AST member tokens
and exact structural references, preserving literals and lambda locals. Dynamic root variable
lookups or invalid expressions stop renaming rather than permit an unsafe partial update. Linked
page references are protected; defaults are type-checked and classified defaults masked in lists.

Unit and browser/a11y scenarios are authored. No test, browser preview, axe or benchmark was
executed at the user's explicit request. Acceptance still requires those checks.
