# ADR-0024: Visual screen editor using the shared interpreter

Date: 2026-10-02. Status: accepted. Additive API contract.

The designer edits ScriptDocument directly through script-schema tree helpers. Each command
produces Immer patches and inverse patches; drag, paste, group and ungroup are transactions.
History has no entry limit and stays in memory. Copy/paste also stays in memory, avoiding
accidental publication of sensitive authoring data to the system clipboard.

The canvas uses core-runtime's renderer in an isolated simulation with inert content. An optional
NodeDecorationContext wraps nodes only in the designer. No production command or data-source
port is provided. Selected breakpoints merge validated token overrides into a preview copy.
The production document is preserved and the agent renderer still uses its normal media rules.

Dnd-kit registers palette entries, visible virtual tree rows and the selected canvas handle.
It does not register all runtime nodes as draggable contexts. Drag guides cache geometry once
and update through requestAnimationFrame without writing the document. The layer tree uses
TanStack Virtual; drop commands recheck registry parent/child rules and reject ancestor cycles.

The property panel uses registry metadata and the Zod property schema. CodeMirror edits text
only; expression parsing and diagnostics use packages/expr. Actions remain the closed schema
union; nested conditional branches use the same schema. Structured parameters can use JSON
editors; these never execute JavaScript.

Drafts save through the existing audited PUT endpoint with CSRF and If-Match after a debounce.
Concurrent changes stop automatic saving. Before-unload and a data-router blocker protect dirty
work. ScriptVersion now includes required `screens` metadata (pin, mode and page IDs), so a
client cannot unknowingly remove links on autosave. Linked pages are read only; their consumers
are fetched through authorized impact and campaign APIs. Adding a link saves and reloads the
server-composed document rather than manufacturing shared page IDs in the browser.

Tests are authored but intentionally not executed at the user's request. 60 fps, browser
interaction correctness and zero axe violations remain acceptance checks, not verified claims.
