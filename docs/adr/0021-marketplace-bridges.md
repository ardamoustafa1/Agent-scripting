# ADR-0021 — Marketplace SDK bridges and CRM launch hosts

Date: 2026-10-01. Status: accepted (implementation validation pending).

SDK desktop platforms require vendor host sessions, while service credentials must remain server-side. Amazon has a server event source; NICE has agent-session polling; Five9 requires a licensed desktop Toolkit. CRM record ownership does not prove CTI call ownership.

Use additive `Connector` implementations with explicit kinds and a strict version-1 server bridge envelope. A shared TLS NATS adapter and worker carry durable events, commands and fresh participant lookups. Vendor SDK facades are injected, credentials remain in the vault/server process, and browser events are hints requiring authoritative enrichment. Amazon includes a native EventBridge mapper; other native event normalizers are installed with tenant-specific SDK facades. Unknown/expired state and server lookup failures deny launch.

Use existing generic adapter type for Flex and CRM kinds to avoid a DB enum/API breaking change. Routing external keys remain resolved by campaign mappings and the server Assignment engine. Capabilities explicitly separate CRM launch-only hosts from telephony connectors. Browser-safe launch code uses a separate SDK export to avoid node:crypto imports. Salesforce/Dynamics iframes use the existing Prompt 11 launch redemption flow and never choose scripts by query parameters.

Consequences: installed vendor SDK versions require explicit bindings and sandbox verification. In-memory dedupe is bounded and cannot guarantee process-restart command idempotency; production facades must use vendor idempotency or a durable journal. Source cursors/checkpoints must persist. Fixture tests are written but deliberately unexecuted at the user's request; step 22 remains in progress. No new public HTTP API or audit mutation handler is introduced.
