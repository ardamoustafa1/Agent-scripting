# ADR-0005: NATS JetStream as event bus; BullMQ for jobs

- **Status:** Accepted · 2026-10-01
- **Related:** [ARCHITECTURE §5.3](../ARCHITECTURE.md), [DOMAIN AuditEvent](../DOMAIN.md#auditevent)

## Context
Services need durable, ordered, replayable events (audit, analytics, realtime fan-out, connector events) with low latency, simple on-prem operation, and tenant-aware subjects.

## Decision
- **NATS JetStream** is the event bus. Subject scheme: `verbis.<context>.<aggregate>.<event>.v<N>` with tenant in a header (and in subject for per-tenant consumers when needed). Streams: `AUDIT` (limits retention, file storage, replicated R3), `SESSION`, `INTERACTION`, `DOMAIN`.
- **Transactional outbox** → publisher → JetStream (exactly-once effect via `Nats-Msg-Id` dedupe + idempotent consumers).
- Event schemas are zod-defined in `@verbis/schemas`; versioned; consumers tolerate additive changes.
- Consumers: durable pull consumers with ack, backoff, DLQ subject.
- **BullMQ (Redis)** is for scheduled/delayed/background **jobs** (retention purge, exports, report generation), not for domain events.
- Realtime to browsers goes service → BFF over SSE/WebSocket, not by exposing NATS.

## Consequences
- (+) Single small binary, easy on-prem HA, strong ordering per subject, replay.
- (−) Team must learn JetStream semantics; need monitoring of consumer lag.
- (−) Two async mechanisms (events vs jobs) — boundary documented to avoid misuse.

## Alternatives
- Kafka: heavier ops, overkill on-prem.
- RabbitMQ: weaker replay/stream semantics.
- Redis Streams only: less durable guarantees, no subject model.
