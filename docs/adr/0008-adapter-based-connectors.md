# ADR-0008: Adapter-based connectors for CTI and channels

- **Status:** Accepted · 2026-10-01
- **Related:** [ARCHITECTURE §4.4](../ARCHITECTURE.md), [DOMAIN Connector](../DOMAIN.md), [SECURITY §4](../SECURITY.md)

## Context
Verbis must work with Genesys Cloud, Genesys Engage (**no WDE integration**), Avaya (AES, AXP, AACC), Amazon Connect, Cisco, NICE CXone, Five9, and CTI-less environments, across voice and digital channels. Platform specifics must not leak into core, runtime, or scripts.

## Decision
Define a stable **`@verbis/connector-sdk`** contract; each platform is an **adapter** hosted by `connector-hub`.
- **Inbound:** adapters emit normalized `InteractionEvent`s (`offered`, `connected`, `held`, `transferred`, `ended`, `attributesChanged`, participant changes) with channel type and platform attributes; identity mapping to Verbis users via `User.ctiIdentities`.
- **Outbound commands** (capability-declared): hold/resume, transfer, conference, send message, set disposition/wrap-up, update attached data. Adapters declare `capabilities` per channel; scripts/actions are validated against them.
- **Verification hook:** `verifyInteraction(interactionId, userIdentity)` queries the platform API — required for secure launch re-verification.
- **Lifecycle:** configuration schema (zod), secret refs, health checks, backoff reconnect, rate-limit handling, idempotent event delivery with dedupe keys.
- **CTI-less adapter:** `generic` adapter accepts signed launcher calls from tenant-registered services and a manual/standalone mode; same normalized events.
- **Genesys Engage:** server-side integration only (T-Server/Platform SDK, GMS or Open Media APIs per open decision OD-2); **no Workspace Desktop Edition (WDE) extension or dependency**.
- **Contract test kit** shipped in the SDK + mock platform simulators; every adapter must pass it in CI. Adapters never touch the DB; they communicate via the SDK ports (events to runtime/NATS, commands from runtime).
- Adapters run in isolated workers with per-adapter credentials and network policy; failures isolated (bulkhead).

## Consequences
- (+) New platform = new adapter, no core change; consistent security and testing.
- (+) Capability model makes cross-platform feature differences explicit.
- (−) Lowest-common-denominator pressure; mitigated by capabilities and platform-specific extension attributes.
- (−) Maintenance of many integrations; prioritize via roadmap steps 18–22.

## Alternatives
- Per-platform code paths in core: unmaintainable.
- iPaaS/middleware dependency: external dependency, latency and security surface, not on-prem friendly.
