# Verbis Competitive Positioning

Related: [ARCHITECTURE](ARCHITECTURE.md) · [SECURITY](SECURITY.md) · [SCRIPT_MODEL](SCRIPT_MODEL.md) · [PROGRESS](PROGRESS.md)

**Targets:** Awaken Intelligent Desktop / Call Scripter, Synergy, and similar agent-scripting tools. This document states **goals and hypotheses**, not verified claims about competitors; validate each row with hands-on evaluation before using it in sales material.

**2026-10-05 latest evidence refresh:** [Improvement acceptance](verification/AWAKEN_IMPROVEMENT_ACCEPTANCE_2026-10-05.md) fixes the rapid-select focus trap behind the peer-edit failure and records fresh full real product matrices: Chromium45/45, Firefox45/45, WebKit45/45; transport reconnect, room rejoin and save/reopen are covered. [Matched task and pilot packet](verification/awaken-benchmark-20261005/EXECUTION_PACKET.md) is ready, with a five-page/three-branch/two-source reference task and three intentional defects; Verbis mock-only runtime benchmark11/11. User deferred real vendor/Awaken/pilot access, so comparative authoring/debugging/AHT results remain unmeasured. [Previous comparison](verification/AWAKEN_COMPARISON_REFRESH_2026-10-05.md) and its44/45 failure remain historical. [Local remaining acceptance](verification/REMAINING_ACCEPTANCE_2026-10-05.md) separately covers isolated simulator/active Agent and nginx header/performance gates. Overall superiority and enterprise production acceptance remain unproven; licensed vendor lifecycle, operational HA/DR, live AI and matched human benchmarks remain open.

**2026-10-06 authoring refresh:** [Authoring acceptance](verification/COMPETITIVE_AUTHORING_2026-10-06.md) closes translated component/page search, bounds large search result DOM, revokes stale regression readiness and adds keyboard canvas scrolling. Lowercase lifecycle state labels are fixed. Fresh full Designer Chromium247/247 and real product Chromium45/45; these are our product acceptance counts, not competitor scores. KMS transit, distributed owner failover, deterministic historical replay and operational restore acceptance remain open alongside deferred vendor/Awaken/pilot access.

## 1. Differentiators

Expanded design, quality bar and wave plan: [DIFFERENTIATORS](DIFFERENTIATORS.md) (2026-10-06).

| # | Capability | Verbis target | Typical gap we aim to close | Where it lives | Step |
|---|---|---|---|---|---|
| 1 | **Real-time co-editing** | Multiple designers edit the same script simultaneously (CRDT), presence cursors, comments, conflict-free merges | Check-in/check-out or last-save-wins | designer-web + core-api collab hub | 33 |
| 2 | **Visual debugger** | Step through rules/flows/actions, inspect variables and data source I/O (redacted), breakpoints, replay a real session's events | Print-style testing, trial-and-error in production | designer-web + SessionEvents | 34 |
| 3 | **A/B testing** | Assignment-level variants with weights, sticky bucketing, outcome-based statistics | Manual script swaps, no stats | Assignment `abTest` + analytics | 31, 34 |
| 4 | **Version diff & rollback** | Structural, node-id-keyed diff; visual side-by-side; one-click pin/rollback; checksum provenance per session | Opaque versions, file-level compare | ScriptVersion + designer-web | 14, 33 |
| 5 | **AI assistant** | Draft screens/flows from a brief, suggest rules, translate TR↔EN, explain diffs, generate test data — guardrailed, tenant opt-in, PII-free prompts, outputs validated by the same zod schema | None or ungoverned | designer-web + core-api | 34 |
| 6 | **Secure launch** | Opaque, single-use, ≤60-second code, stored only as a hash; user/tenant/interaction binding and platform verification; no identifying-parameter opening | Screen pop by plain URL params (spoofable) | runtime-session + connector-hub | 23 |
| 7 | **Hash-chained audit** | Tamper-evident, verifiable, searchable, SIEM-exportable, WORM-anchored | Mutable logs or basic history | audit-service | 6 |
| 8 | **Component SDK** | Third-party/customer components on core primitives, sandboxed, SRI-pinned, a11y contract enforced | Closed component set or unsafe custom JS | component-sdk | 27 |
| 9 | **Omnichannel simultaneous sessions** | One agent, multiple concurrent interactions across voice/chat/email/SMS/WhatsApp/social/video with isolated session state | Voice-first, bolt-on digital | runtime-session + Channel | 24, 30 |

## 2. Additional advantages

- **Platform breadth:** Genesys Cloud, Genesys Engage (no WDE dependency), Avaya AES/AXP/AACC, Amazon Connect, Cisco, NICE CXone, Five9, and CTI-less via a single adapter contract ([ADR-0008](adr/0008-adapter-based-connectors.md)).
- **Core-primitive architecture:** Box/Button/WebService kernel → small attack surface, consistent behavior, extensible by composition ([SCRIPT_MODEL §4.1](SCRIPT_MODEL.md)).
- **No-code logic with safe expressions:** rule builder + sandboxed expression engine; no eval ([ADR-0007](adr/0007-safe-expression-engine.md)).
- **Server-side integrations:** REST/SOAP/GraphQL proxy; secrets never in the browser; SSRF-guarded ([SECURITY §5.1](SECURITY.md)).
- **Identity:** multi-IdP per tenant (OIDC + SAML 2.0) and SCIM 2.0; BFF pattern ([ADR-0004](adr/0004-bff-auth.md)).
- **Compliance-ready:** KVKK/GDPR/PCI-DSS scope reduction, classification-driven redaction ([SECURITY §6](SECURITY.md)).
- **UX quality:** WCAG 2.2 AA, dark mode, TR/EN, keyboard-first; consistent design system.
- **Deployment freedom:** SaaS multi-tenant or on-prem/air-gapped with the same artifacts.
- **Open contracts:** OpenAPI, versioned JSON script model, event schemas.

## 3. Evaluation plan

| Dimension | Method | Success criterion |
|---|---|---|
| Authoring speed | Timed task: build a 5-screen script with 2 data sources | ≥ 2× faster than baseline tool |
| Agent handle-time impact | A/B on pilot campaign | Statistically significant AHT or conversion improvement |
| Runtime latency | k6 + RUM | p95 screen render < 200 ms after data; launch redeem p95 < 300 ms |
| Reliability | Chaos tests | Launch fails closed; sessions survive single-node loss |
| Accessibility | axe + manual AT testing (NVDA/VoiceOver) | 0 critical issues; WCAG 2.2 AA conformance report |
| Security | External pentest | No high/critical open at GA |
| Integration time | Time to connect a new platform | < 2 weeks per adapter using SDK + contract kit |

## 4. Risks

- Breadth of CTI adapters may dilute depth → prioritize Genesys Cloud, Avaya AACC, Genesys Engage first (steps 19–21), contract-test all.
- CRDT complexity and schema migrations → ADR in step 33; document-size and node limits ([SCRIPT_MODEL §1](SCRIPT_MODEL.md)).
- AI features carry data-leak/compliance risk → opt-in, PII scrubbing, audit, schema-validated outputs.
