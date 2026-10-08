# ADR 0049 — Canary rollout on A/B assignments, with an evidence-based rollback guard

Status: Accepted · 2026-10-07 · DIFFERENTIATORS C4 (builds on [ADR-0015](0015-authoring-lifecycle-routing.md), [ADR-0031](0031-session-analytics-and-reporting.md), [ADR-0048](0048-sequential-ab-inference.md))

## Context

A new script version reaches every agent the moment an assignment resolves to it. We want to
expose it to a small share of traffic first and take it back automatically if it hurts. The
platform already has everything needed except the policy: sticky A/B bucketing with per-arm
`pinnedVersionId` and basis-point weights (`Assignment.abTest`), analytics attributed per arm
(`experimentId` = assignment id), always-valid tests and separate guardrail metrics (ADR-0048).

## Decision

1. **A rollout is not new state.** It is an assignment whose `abTest` has exactly two arms keyed
   `stable` and `canary`. The stage is the canary weight; the ladder is 5% → 25% → 50% → 100%
   (`STAGES`). No table, no migration, no new public write endpoint: stages are changed with the
   existing `PATCH /v1/assignments/:id` (`variants`), which already authorises, audits and
   invalidates the routing cache.
2. **`GET /v1/assignments/:id/rollout`** returns a verdict computed from the last 14 days of
   metadata-only analytics facts of that experiment: `hold`, `advance` or `rollback`, the reason,
   the metrics that breached, and a `proposal` (the full `variants` array to PATCH).
3. **Rollback needs positive evidence of harm.** A guardrail (abandonment, required-notice
   compliance) where the canary is significantly worse, or a significant drop in completion, both
   with always-valid p-values, so repeated looks do not inflate false rollbacks. Harm is acted on
   regardless of traffic volume.
4. **Advance is advisory.** It needs ≥ 100 sessions on both arms and no harm signal. A missing
   significant difference is not proof of safety, so a person applies the next stage.
5. **Automatic rollback is opt-in.** `ROLLOUT_GUARD_ENABLED` (default off; requires
   `ANALYTICS_ENABLED`) starts a 60 s guard that evaluates every active canary in every active
   tenant and, only on a `rollback` verdict, sets canary weight 0 / stable 10 000 and keeps both
   pinned versions. It runs as the service principal `rollout-guard`, never advances, is
   idempotent (a rollout that is no longer an active canary is skipped), and writes the audit
   event `assignment.rollout.rolledBack` (`automatic: true`, breached metrics, previous weight) plus the
   normal `assignment.assignment.updated` diff and routing-cache event in the same transaction.

## Consequences

- Sticky bucketing means sessions already routed to the canary keep their arm until they end;
  rollback affects new resolutions. Advancing a stage keeps existing buckets in the canary
  (bucket ranges only grow).
- The verdict is observational about versions and causal only as far as bucketing is random and
  sticky (it is). Guardrails are limited to what analytics facts carry today.
- Not covered: per-guardrail thresholds per tenant (fixed policy in code), notifying humans of an
  automatic rollback beyond the audit event/SIEM stream, a designer UI for stages (the verdict and
  proposal are API-only so far).
