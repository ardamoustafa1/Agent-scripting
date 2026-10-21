# ADR 0056 — A runtime data-source call is authorized by the agent's own interaction session

Status: Accepted · 2026-10-21 · Decided by the product owner. Changes the runtime part of the
"scoped permission" check in [ADR-0016](0016-runtime-session-engine.md) /
[ADR-0039](0039-runtime-io-and-payment-token-recovery.md); the preview rule of
[ADR-0017](0017-secure-launch.md) and the authoring rules of
[ADR-0026](0026-integration-authoring.md) are unchanged.

## Context

When a script calls a web service during a call, agent-web posts to
`POST /v1/sessions/{id}/desktop/data-source`. `IntegrationEngineService.prepareAuthorized` then
checked ownership, an active session and the exact version pin, and additionally required
`execute:Integration` on the data source.

No system role an agent normally holds has that permission: the `agent` role reads its campaigns'
scripts and reads/updates its own sessions. So an agent provisioned with only `agent` (the normal
SSO group mapping) could open a script but every service call in it failed with
`VERBIS_AUTHZ_FORBIDDEN`. Local and live tests had not shown it because they ran as a tenant
administrator. The clean demo (`tests/demo-smoke`) found it at the survey's submit step.

Granting `execute:Integration` to agents is not the answer: the same permission opens the
authoring surface (sandbox test console, designer runtime simulation, previews with live data,
the private egress worker API). An agent would be able to run any saved data source with a test
profile and arbitrary input, not only what a published script asks for.

## Decision

1. **Interaction sessions.** A call made from a real interaction session (`sessions.kind =
   'interaction'`) is authorized by that session. All of the following must hold, and fail closed:
   - the principal is a user with a BFF session (desktop route: SSO, the session's owner, holding
     the writer lease; unchanged);
   - the session belongs to that user in the same tenant, is `active`, not ended and not deleted
     (unchanged query);
   - the user may `update` that session (instance-level CASL check, `agentId` = the user; the
     `agent` role grants this for its own sessions only);
   - the data source is declared in the session's **published script version** and resolves to
     the **exact pinned immutable revision** (ADR-0046; unchanged, a moved live row without a
     snapshot is still refused).
   `execute:Integration` is **not** required for this call.
2. **Preview sessions keep the authoring rule.** A `preview` session reaches live data only when
   it was started with live data by someone holding `execute:Integration` (ADR-0017), and each
   call still requires `execute:Integration`.
3. **Unchanged:** the signed-token route `POST /v1/sessions/{sessionId}/data-sources/{id}/execute`
   keeps its type-level `@Can('execute', 'Integration')`; it is not used by agent-web. Profile and
   environment come from the server, secrets never reach the browser, SSRF/origin checks, policy
   timeouts, mocks, the `integration.datasource.executed` audit event and the analytics outbox
   event are as before.

## Consequences

- An agent can call exactly the services that the script version assigned to its own active
  call pins, with the inputs that script computes, and nothing else. It gains no access to data
  source definitions, test consoles, previews or other sessions.
- Roles that relied on `execute:Integration` to call from an interaction session they own still
  need `update` on that session; every user role that can create one (`agent`, `tenant_admin`,
  `super_admin`) has it.
- Security-critical coverage: unit tests over every system role (allowed iff the role may update
  its own session), the preview rule, ownership/active-session/pin refusals, and a Testcontainers
  test through the agent-desktop controller with an agent-only ability.
