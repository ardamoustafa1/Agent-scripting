# ADR 0048 — Sequential A/B inference and guardrails

Status: Accepted · 2026-10-07 · DIFFERENTIATORS F1 (supersedes the "not a sequential testing framework" limit in [ADR-0031](0031-session-analytics-and-reporting.md); that ADR is not otherwise changed)

## Context

The dashboard compares variants with a fixed-horizon pooled z-test and a Bonferroni correction. The
dashboard is refreshed continuously, so users look at it repeatedly and stop when it "turns
significant". A fixed-horizon p-value is only valid if the sample size is chosen in advance;
peeking inflates the false-positive rate well beyond 5% (the unit test simulates this: ~0.1–0.3 for
the naive test vs ≤ 0.05 for the method below, 400 deterministic A/A trials, 40 looks each).

## Decision

1. Each comparison additionally carries an **always-valid p-value**, `anytimePValue`, from the
   normal-mixture mSPRT for a difference of proportions (Johari et al. 2017). `min(1, 1/Λ)` is
   valid at any data-dependent stopping time. It is recomputed from the current counts (stateless
   projection), so it is slightly more conservative than the running minimum and never less valid.
2. Parameters are fixed in code, not per-tenant: mixing standard deviation `τ = 0.05` (tuned for
   differences of a few percentage points), α = 0.05, at least 30 sessions per arm. Cells below the
   minimum return `null` and `insufficient`. Multi-arm experiments use the same within-experiment
   Bonferroni correction (union bound; valid for always-valid p-values).
3. The legacy fixed-horizon `pValue`/`significant` fields stay unchanged for backward compatibility
   and are described as fixed-horizon. New fields are optional in the schema (additive; no
   breaking OpenAPI change). **Decisions made while the experiment is running must use
   `anytimePValue`.**
4. **Guardrails** are compared separately from the primary metric, never folded into it:
   abandonment rate and required-notice compliance (a session is compliant when it read every
   required notice it was shown; sessions with no required notice are excluded). Each guardrail
   has its own mSPRT; `worse` names the arm that is significantly worse, else `null`.
5. **CUPED** (`cuped()` in `sequential.ts`) is provided as a tested pure function: pre-period
   covariate, θ estimated on the pooled arms. It is **not yet wired** into the dashboard because
   facts carry only HMAC pseudonyms of agents and no previous-period aggregate; wiring needs a
   per-agent baseline read model and its own privacy review.

## Consequences

- Early reading is safe; the price is lower power than a fixed-horizon test at the planned
  sample size. The mixture is conservative for effects much larger or smaller than τ.
- Recommendations (`recommendVariant`) still use the fixed-horizon rule plus data-loss and
  sample-size gates; they are meant for final readouts, not live decisions.
- No causal claims: assignment must be randomized and sticky (existing `abTest` bucketing).
