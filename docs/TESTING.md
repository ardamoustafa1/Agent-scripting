# Test strategy and execution

Read [CLAUDE.md](../CLAUDE.md) before modifying tests. The initial authoring pass did not
execute suites. The user subsequently authorized local test execution and repairs; observed
unit, integration, browser, coverage, mutation and connector results are recorded in
[the verification record](VERIFICATION_2026-10-03.md). Live staging SAML/SSO, two-user
collaboration and real-agent acceptance remain user-deferred and are not passing results.
Static TypeScript checks are not evidence of passing tests.

## Required coverage

| Scope | Lines / statements / functions / branches |
| --- | --- |
| Runtime packages | ≥90% each |
| API (unit + real integration) | ≥85% each |
| Frontends | ≥80% each, also ≥80% for each configured critical directory |
| expr | Existing stricter 98/98/98/95 thresholds retained |
| script-schema / authz | Existing stricter 95/95/95/90 thresholds retained |

Vitest includes runtime source files, including files never imported by a test. Generated code,
entry points and pre-existing test-only exclusions stay excluded. Configuration-only packages
without a Vitest suite have no runtime coverage requirement. Do not add exclusions to make a
failing gate pass. Frontend critical directory thresholds cover authoring/editor/flow/rules/
lifecycle/integrations/preview, agent launch/desktop, and admin workspace where these directories
exist. Browser screenshots and route mocks do not contribute to Vitest coverage.

Every suite emits text, JSON, JSON summary, LCOV and HTML. The CI quality job runs coverage,
then `coverage:check` even on failure and uploads all reports. Missing, empty, malformed or
below-target reports fail the job; workspace failures cannot be disguised by a global average.
Vitest enforces the stricter module and directory thresholds before the repository gate.
Require the CI quality check in repository branch protection (a repository setting, not a file).

## Layers and critical scenario map

| Scenario | Authored evidence |
| --- | --- |
| OIDC SSO, cookie flags, failed login, sign-out | admin `keycloak-login.spec.ts`; real dev Keycloak CI job |
| SAML sign-in/sign-out and unsigned assertion rejection | admin `saml-live.spec.ts`; real configured IdP live project |
| Signed/encrypted SAML, replay, audience, expiry, transaction and tenant binding | API `identity-saml.int.spec.ts`; real API and test IdP |
| New script, palette drag/drop, decision edges, service node, rule and optimistic save | designer `editor.spec.ts` |
| REST definition creation, mapping/import and credential redaction | designer `integrations.spec.ts` |
| Regression before approve/publish, state changes and campaign assignment | designer `lifecycle.spec.ts`; API script lifecycle/assignment integration suites |
| Simulator → secure launch → agent inputs → service → wrap-up → platform ACK | agent `desktop-live.spec.ts` against real API/hub/simulator |
| Launch parameter spoofing, code scrubbing, origin/message/capability and session attacks | agent `launch.spec.ts` / `security.spec.ts`; API launch integration suites |
| Audit browser view, valid/broken/bounded range results and CSRF | admin `hello.spec.ts`; real verification/filtering in `audit-live.spec.ts` |
| Two isolated SSO browser contexts, remote edit, flush and reconnect | designer `collaboration-live.spec.ts`; real Hocuspocus service |
| Main designer, agent and admin screen light/dark | Six `@visual` screenshot assertions in editor/desktop/hello specs |

The designer first-draft button now creates a real validated page → end document through the
BFF with CSRF, an idempotency key and permission checks. Its unit test validates the document
and isolation between drafts; the browser test begins with an empty version list and explicitly
posts the first version before opening the canvas. The service reference enters through the
existing pinned subflow import UI.

The regular Chromium UI lane mocks BFF responses: it proves browser behavior, not database,
IdP or connector integration. In the new-script test the imported tenant service reference is a synthetic
fixture; the service authoring test checks its separate creation contract. API integration uses
Testcontainers PostgreSQL/Redis/NATS and real HTTP entry points. The `live` project uses deployed
services with no response mocks; it is an explicit acceptance gate before release.

## Commands (not executed in this change)

Prerequisites: Node from `.nvmrc`, pnpm 9, Docker for API/hub integrations, and Chromium for E2E.
Install dependencies and build shared workspaces before running suites:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @verbis/agent-web exec playwright install --with-deps chromium

pnpm test                          # coverage for all runtime workspaces
pnpm coverage:check                # requires reports from the preceding run
pnpm test:policy                   # report/quarantine policy regression tests
pnpm --filter @verbis/api test:unit
pnpm --filter @verbis/api test:integration
pnpm --filter @verbis/api test:perf # expensive throughput lane, excluded from normal API coverage run
pnpm test:contracts
pnpm e2e
pnpm test:visual
pnpm test:mutation
pnpm test:flaky
pnpm test:quarantine
```

`pnpm test:contracts` runs all connector specs under `src/connectors`, including the shared kit
for webhook, simulator, Genesys Cloud, Engage sidecar/workspace, Avaya AES/AACC/AXP, Amazon
Connect, Cisco Webex/Finesse, NICE CXone, Five9, Twilio Flex and Salesforce/Dynamics. Registry
inventory tests require every declared adapter type to have a factory and shared-kit spec.
Harness cleanup is bound to the individual test, also after assertion failure. Native licensed
vendor SDK tests still require their labs; fixture contracts do not prove vendor compatibility.
The main CI quality job already includes hub contracts; the Java sidecar jobs run their contracts
and transport tests independently.

## Visual regression

Use the same Linux/Chromium/Playwright version as CI, fixed 1440×1000 viewport, fixed wall clock,
synthetic content, loaded fonts and disabled animations. Six assertions allow at most 0.1%
pixel differences. No reference images were fabricated or captured in this change. The first
visual run **fails until reviewed baselines exist**; capture them only when execution is authorized:

```sh
pnpm test:visual --update-snapshots
```

Review and commit generated `*.spec.ts-snapshots/*-chromium-linux.png` files. CI must compare
against committed references; never update snapshots automatically or mask changing content to
hide defects. The existing axe and keyboard tests cover WCAG 2/2.1/2.2 AA in light/dark/high contrast.

## Mutation testing

Stryker 10 and its Vitest runner are pinned for expr and script-schema. They mutate production
TypeScript and exclude specs, fixture generators and barrel exports. Mutation coverage is per
individual test; reports are written to each package's `reports/mutation/`. A score below 80 fails;
80–89 is a review warning band, ≥90 is the target. Existing line coverage security thresholds
remain independent. Boundary tests pin strict/inclusive comparisons, null coalescing, context
isolation, array patch indices, immutable inserted values and atomic rollback.

`test-depth.yml` runs a package matrix on relevant PRs, nightly and on manual dispatch. Surviving
mutants must be reviewed; do not disable mutators or mark production mutations ignored just to
reach the score. Equivalent mutants require a documented reason and review.

## Flaky detection and quarantine

All browser specs import the shared fixture in `tests/playwright/test.ts`. The reporter emits
`test-results/flaky.json` with stable project/file/title, retry/repetition status and duration.
A retry that passes after failing still fails normal CI. The stability lane repeats tests five
times with retries disabled and detects mixed outcomes across repetitions. Consistent failures
continue to fail; no failure automatically enters quarantine.

The reviewed `tests/playwright/quarantine.json` starts empty. Each entry must specify `project`,
`file` (relative to that app's `e2e` directory), full describe/test `title` joined by ` › `,
`owner`, `reason`, HTTPS issue URL, `createdAt` and `expiresAt` ISO timestamps. Maximum window
is 14 days; expired, duplicate or malformed entries fail validation. Authentication, secure
launch and audit tests cannot be quarantined. Review is required to add an entry; remove it
when the issue is fixed. The fixture annotates and skips only the exact matching test in the
regular lane; the nightly/manual quarantine lane runs that test with failures still fatal.
This does not change application security policy.

Example identity (metadata and timestamps must be supplied for a real issue): project `chromium`,
file `editor.spec.ts`, title `palette drag creates a node; undo and redo restore it`.
Do not rename titles to evade tracking or leave broad file skips in a quarantine entry.

## Live acceptance prerequisites

Use a disposable, synthetic tenant. API, hub, Redis/NATS, simulator and collaboration endpoint
must be healthy; the browser applications must proxy `/api`, Socket.IO and `/collaboration`.
Run `pnpm test:live`. It rejects missing configuration rather than reporting skipped acceptance
as green; no local services are spawned when `E2E_LIVE=1`.

Required environment:

- `ADMIN_E2E_BASE_URL`, `DESIGNER_E2E_BASE_URL`, `AGENT_E2E_BASE_URL`: real app origins; HTTPS
  outside loopback.
- `SAML_E2E_TENANT`, `SAML_E2E_IDP_ID`, `SAML_E2E_IDP_ORIGIN`, `SAML_E2E_USERNAME`,
  `SAML_E2E_PASSWORD`: active synthetic SAML provider. Default IdP selectors are Keycloak
  `#username`, `#password`, `#kc-login`; optional `SAML_E2E_*_SELECTOR` overrides support another IdP.
- `ADMIN_E2E_STORAGE_STATE`, `DESIGNER_E2E_AUTHOR_STATE`, `DESIGNER_E2E_PEER_STATE`,
  `AGENT_E2E_STORAGE_STATE`: absolute paths to short-lived Playwright auth states outside the repo.
  Designer users must be different identities in the same tenant with draft update access.
- `DESIGNER_E2E_SCRIPT_ID`, `DESIGNER_E2E_DRAFT_NUMBER`: disposable editable draft. Prepare
  a fresh draft before each repeated acceptance run; collaboration writes actual draft data.
- `AGENT_E2E_CONNECTOR_ID`, `AGENT_E2E_PLATFORM_USER`: enabled simulator with agent mapping,
  published script/campaign assignment, `Customer name` input, `Lookup` service, next page and
  `Success` disposition. Optional input/lookup/outcome labels use `AGENT_E2E_*_LABEL`.
- `AUDIT_E2E_FROM_SEQ`, `AUDIT_E2E_TO_SEQ`: small known complete audit range with valid chain;
  optional `AUDIT_E2E_ACTION` filter defaults to `script.version.published`.

`live-acceptance.yml` runs manually in the `test-staging` environment using the above variables
and short-lived auth JSON secrets. Missing or expired fixtures cause a failure. Login traces,
screenshots/video and live HTML reports are disabled or not uploaded; authentication states are
removed even after failure. Never commit credentials, real customer data or auth state files.
OIDC has its independent automatic Keycloak dev CI lane.

## Acceptance still pending

Execute suites when authorized, review coverage deficits and surviving mutants, capture/review
Linux visual baselines, configure synthetic staging fixtures and run real critical journeys.
Coverage targets are enforced in code, **not yet demonstrated**. Connector contracts are authored,
**not yet demonstrated green**. CI files alone do not establish branch protection or deployed
service readiness; release acceptance requires the actual reports.

## Deployment acceptance (authored, not executed locally)

The deployment-policy CI lane renders Helm and checks replica floors, immutable image digests,
non-root/read-only pods, probes, HPA/PDB, migration sequencing, TLS/mTLS header controls,
ExternalSecrets, optional sidecars and canary ownership. Run only when authorized:

```sh
python3 -m pip install PyYAML==6.0.2
python3 -m unittest discover -s deploy/tests -p 'test_*.py'
helm lint deploy/helm/verbis -f deploy/examples/values-render.json --strict
```

API worker-health and hub queue-full readiness regression tests live in their existing Vitest
projects. Release image signing, offline verification, vendor SDK builds, NetworkPolicy
enforcement, failover, WebSocket drain and restore/audit acceptance require disposable staging.


## Final audit and clean demo acceptance (authored, not run)

- `pnpm audit:inventory`: regenerate reviewed mutation-route/call and literal i18n source inventories;
  this is static source analysis, not a runtime pass. Commit/review the resulting docs JSON alongside routes.
- `pnpm test:audit`: route-to-audit reachability, global interceptor order, TR/EN parity/nonempty/literal
  usages. Computed routes and new unaudited Public/SkipAudit paths fail the gate. Discover is the sole
  reviewed read-only POST exemption; branch/transaction behavior still needs integration tests.
- `DEMO_SMOKE=1 DEMO_SMOKE_ENV_FILE=/private/verbis-smoke/env pnpm test:demo-smoke`: explicit isolated
  install/build/migrate/empty-DB seed/service/browser lane, described in
  [smoke README](../tests/demo-smoke/README.md). It requires real isolated IdP/mTLS/dependency fixtures,
  does not reset a database and cannot substitute for SAML/approval/collaboration/load/axe acceptance.

All three commands are documented for future use; the two test commands were not executed here.
The static inventory commands were executed. [FINAL_AUDIT](FINAL_AUDIT.md) is the release finding
record; [ROADMAP](ROADMAP.md) distinguishes missing implementation from missing execution evidence.

## Executed verification on 2026-10-03

The earlier authored/not-run notes above describe historical audit work. The user subsequently
authorized running all created tests. Current measured results, fixes and remaining failed
coverage gates are recorded in [VERIFICATION_2026-10-03.md](VERIFICATION_2026-10-03.md).
Live staging SAML/SSO, two-user collaboration and real-agent acceptance are deferred by the user.
They must not be represented as passed or replaced by local mocks.

The root `pnpm test` command runs package tasks serially and continues independent tasks after
a failure. The expression engine retains its 50 ms safety ceiling; parallel package/coverage
processes can consume that wall-clock budget through scheduler contention. Package-local
Vitest tests retain their configured workers. Coverage failures still return a nonzero exit.
