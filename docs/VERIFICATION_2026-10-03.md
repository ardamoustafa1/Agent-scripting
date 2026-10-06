# Verification run — 2026-10-03

Status: **local automated verification complete on October 4; live acceptance deferred**. The user authorized running all
created tests and repairing gaps. The user subsequently deferred live staging SAML/SSO,
two-user collaboration and real-agent acceptance. These deferred checks are not passes.

## Final October 4 results

- Repository test command: **32/32 successful tasks**, with 31 unchanged task results
  reused from Turbo cache. The 18 Vitest workspace summaries total **4,897 passing tests**.
  The changed API suite ran fresh: **1,782 tests in 140 files, all passed**.
- API coverage: statements **90.18%**, branches **85.07%**, functions **87.78%**,
  lines **92.42%**. All four unchanged 85% gates pass. The separate repository
  `coverage:check` also passes every workspace; no coverage threshold was lowered.
- Final typecheck: **32/32** tasks; lint: **33/33**; build: **19/19**.
  Repository formatting, Playwright support typecheck/lint, audit inventory regressions,
  coverage/flaky policy tests, quarantine policy and diff whitespace checks pass.
- Additional regressions fixed service-client delegation ignoring field-specific denials,
  signed OIDC logout events accepting null/array values, and assignment null bodies
  throwing rather than returning 400. The null request regression passes against real HTTP
  and PostgreSQL without creating an assignment.
- Local identity tests use real signed SAML assertions, EdDSA logout JWTs and openid-client
  grants. OIDC passes 27 focused tests, SAML 21. The Redis session/ticket suite passes 40,
  Hocuspocus/Yjs hooks 20, assignment schemas 20 and assignment service boundaries 16.
  Live provider and two-user staging acceptance remain deferred.
- Outbox assertions now observe the real event-specific JetStream duplicate acknowledgement.
  The test drain also checks for due unlocked rows before treating an empty SQL claim as
  completion, allowing application/database timestamp skew. Its six targeted cases and the
  final complete suite pass, including duplicate delivery, poison messages and the relay loop.
  The preceding failed full run remains recorded in `365-root-tests.log` and is superseded
  by the successful `369-root-tests.log`.
- Final evidence logs: `369-root-tests.log`, `370-coverage-gates.log`,
  `368-root-types.log`, `368-root-lint.log`, `363-root-build.log`,
  `363-audit.log`, `363-policy.log`, `363-playwright-types.log`,
  `363-playwright-lint.log`, `369-quarantine.log`, `368-outbox.log`.
  Unchanged browser, mutation, performance and Java connector evidence below remains valid.
- This completes the executable local test/gate work. Deferred live acceptance and product
  roadmap items are not proven by a passing local suite and are not marked complete.

## Completed evidence

- All 19 production build tasks passed. Designer was rebuilt again after the font CSP fix.
  Agent was rebuilt after launch cancellation, conflict handling and vault cleanup fixes.
- Shared UI browser suite: 167 passed, including reviewed visual baselines, keyboard behavior
  and accessibility checks. Components browser suite: 208 passed. Designer browser suite:
  49 passed. Admin browser suite was rerun on the current build: 14 passed.
- Admin passes 90 unit/integration tests, typechecking, lint, a fresh production build and
  14 Chromium tests. Regression tests exposed synchronous form validation errors escaping
  the form error handler and edited identity-provider JIT/SCIM flags omitted from PATCH.
  Both defects were fixed and their regression tests pass.
- Actual local nginx tests passed for Agent, Admin and Designer. They verify response-specific
  CSP nonces, strict CSP without unsafe-eval/unsafe-inline, Trusted Types enforcement, security
  headers and absence of startup policy violations. Production startup disables schema JIT
  before module initialization; Designer fonts are emitted as same-origin assets.
- Expression mutation score: 82.26%; script-schema mutation score: 82.14%. Both exceed the
  unchanged 80% break threshold.
- Audit route and translation catalog checks: 2 passed. Coverage/flaky policy tests: 4 passed.
  Playwright support files passed typechecking and linting.
- The final full API run passed 1,782 tests across 140 files, including
  isolated database checks. Migration/schema verification passed 8 tests.
- Agent now passes 122 unit/integration tests, all unchanged coverage thresholds and its
  production build. Its current Chromium suite passes 22 tests; the security test passes
  separately against actual nginx. The live desktop performance test remains deferred.
- Regression tests exposed and verified fixes for navigation after launch unmount, conflict
  and authorization messages overwritten by generic sync errors, and cleared draft database
  connections blocking future schema upgrades. Real WebCrypto and IndexedDB tests cover
  ciphertext partitioning, concurrent key creation, corruption and transaction abortion.
- Native ESM API integration loading required a pnpm package extension declaring Nest
  Fastify 12.1.2’s missing RxJS 7 peer. The lockfile was regenerated and the full 1,080-test API
  suite passed afterward; no import mocks or dependency resolution bypasses were used.

- Both Java connector test tasks were rerun with `--rerun-tasks` and Java 21; Avaya and
  Engage completed successfully, including test execution (not merely an up-to-date check).
- Designer's latest full run passed 297 tests in 46 files and all unchanged coverage gates.
  Its fresh production build, all 49 Chromium tests and actual nginx security test also pass.
- Designer regression tests exposed fixes for undoing the active newly created page and
  collaboration conflict/authentication status overwritten by disconnect notifications.
- Bundled template compatibility tests uncovered outdated component properties and unsupported
  ICU parameter/dynamic-option bindings. Template definitions were aligned with current
  component contracts, including the numeric 0–10 NPS control and explicit disposition
  options. Real runtime tests now verify bound ICU parameters, reactive escaped text and
  dynamic select options. All four bundled templates pass literal-property/binding checks
  and transactional subflow-import checks. Components passes 294 tests and all coverage gates.

## Coverage gates

Percentages below come from completed V8 reports, not estimated progress. New meaningful
regressions cover runtime cancellation/navigation/privacy, component interactions, connector
notifications and retries, and the component SDK host/guest/bundle boundary. Thresholds were
not reduced and production files were not excluded to make these gates pass.

| Package | Statements | Branches | Functions | Lines | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| core-runtime | 94.31 | 90.28 | 94.80 | 96.36 | Pass (90% floor) |
| components | 96.13 | 90.63 | 95.65 | 97.84 | Pass (90% floor) |
| connector-hub | 83.47 | 75.14 | 81.71 | 86.40 | Pass (75% floor) |
| ui | 96.95 | 91.06 | 97.14 | 97.30 | Pass |
| sdk-component | 99.30 | 97.03 | 98.03 | 99.61 | Pass |
| api | 90.18 | 85.07 | 87.78 | 92.42 | Pass (85% floor) |
| admin-web | 92.35 | 88.19 | 87.20 | 94.76 | Pass (80% floor, including workspace) |
| agent-web | 91.14 | 84.89 | 85.97 | 93.36 | Pass (80% floor, including launch and desktop) |
| designer-web | 89.14 | 80.06 | 86.73 | 91.16 | Pass (80% floor, including all scoped gates) |

Other completed package gates include script-schema, expr, shared-types, sdk-connector,
observability and collaboration. Passing browser tests do not replace missing application
unit/integration coverage. All listed local coverage gates now pass.

## Reproduction and evidence

Run `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm test:audit`, `pnpm test:policy`, `pnpm test:typecheck` and `pnpm test:lint`.
Targeted browser and mutation commands are documented in TESTING.md. An actual nginx target
is required for the security-header browser test; a Vite preview is insufficient.

Detailed logs for this workspace session are in `/tmp/verbis-verification/`. Relevant completed
runs include `build70.log`, `core81.log`, `components81.log`, `hub67.log`, `ui74.log`,
`ui-browser22.log`, `admin-browser73.log`, `security-edge47.log`, `security-admin74.log`,
`security-designer78.log`, `expr-mutation34.log`, `schema-mutation10.log`, `audit81.log`
`policy81.log`, `api87.log`, `agent109.log`, `agent-build109.log`, `agent-browser110.log`
and `security-agent110.log`, `admin-coverage125.log`, `admin-types125.log`,
`admin-lint125.log`, `admin-build126.log`, `admin-browser126.log`, `security-admin128.log`,
`designer-coverage180.log`, `components-coverage180.log`, `schema-coverage172.log`,
`designer-import171.log`, `designer-collaboration155.log` and the Java rerun logs numbered 128. Temporary logs are not a durable release artifact. This document records
only observed completed results. The final October 4 section supersedes the historical progress below.

## Historical progress before the final successful run

The following dated entries preserve intermediate failures and repairs. Their open-gate status
is superseded by the final results above.

### October 4 continuation

- Real runtime encryption exposed a privacy request defect: the service used scopes rejected by
  RuntimeCipher. Privacy subjects/reasons now use explicit tenant- and record-bound scopes.
  Thirteen privacy service regressions, cipher isolation tests and five real PostgreSQL API
  integration tests pass. Anonymization also rejects a missing locked interaction before writes.
- Inspector icon/tone controls now honor declared schema options; previously icon choices could
  produce invalid outcome components. All ten inspector behavior tests pass. The decorative
  tenant mark is hidden from assistive technology so the organization button has the correct name.
- Designer coverage includes actual ReactFlow/ELK, keyboard drag/drop, shared-screen attachment,
  scenario loading, integration file upload, and permission checks across workspace routes.
- Fourteen administration service tests cover platform-only access, optimistic versions,
  connector secret ownership, real Ed25519/EC key imports and locked CTI identity mappings.
  Seventeen report tests cover retention/legal hold, scheduling, owner/recipient authorization,
  bounded CSV delivery and retryable mail failure. Mail transports are synthetic test doubles;
  these tests send no external messages. Thirteen team service tests cover comments, mentions,
  thread version protection and review eligibility. The completed full API rerun passed 1,367 tests; its 85% coverage gates remain unmet.
- Latest logs: `designer-coverage231.log`, `build233.log`, `designer-browser236.log`,
  `designer-security239.log`, `api-coverage226.log`, `api-reports228.log`, `api-team235.log`.
  All 32 repository typecheck tasks passed. Repository-wide lint and formatting corrections are being verified again.


## October 4 additional API verification (ongoing)

- The completed repository test run passed 31 of 32 tasks; API assertions passed but its
  unchanged 85% coverage gate failed. Package test tasks now run sequentially to prevent
  unrelated packages from consuming the expression engine's fixed 50 ms execution budget.
- The last completed API coverage run (`api-coverage287.log`) passed 1,367 tests in 126 files.
  Lines pass at 86.84%; statements 84.15%, functions 83.09% and branches 76.76% remain below
  85%. Later targeted additions have not yet been included in that full measurement.
- Update-only integration permissions no longer incorrectly require creation permission.
  Authoring and package tests exercise permission/version guards and real Ed25519 signatures.
- Archive read-back now requires the configured lock mode, valid future retention and the
  requested retention deadline. Expired backlogs receive a future upload deadline; retries
  reuse the persisted deadline. Session sequence driver values retain numeric NDJSON format.
  Seventeen archive unit tests pass. The real PostgreSQL audit suite passes 32 tests, including
  complete archived rows, actor details, hash matching and idempotent registry writes.
- Runtime engine tests cover writer leases, masking, commands, expiry and bounded snapshots.
  Runtime job tests cover connector writeback, real outcome envelope decryption, retry settings
  and outage metrics. AI service tests pass 39 cases covering session ownership, approved
  proposal references, duplicate billing protection, quota reconciliation and provider failure.
- SCIM malformed email-array entries now produce 400/invalidValue rather than a TypeError.
  A real PostgreSQL regression also reproduced successful but unpersisted locale-only patches.
  Locale changes now persist with the same two-letter normalization as provisioning; removal
  uses the existing User schema default. The full SCIM integration file passes 8 tests.
- OIDC/SAML administrator lifecycle tests use generated synthetic certificates and no live IdP.
  They cover write-only secrets, domain savepoints, credential promotion/removal, optimistic
  versions, SCIM token hashing and session revocation. Live acceptance remains user-deferred.
- Relevant additional logs: `api-mapping-scim267.log`, `api-archive-integration270.log`,
  `api-jobs271.log`, `api-storage274.log`, `api-scim278.log`, `api-ai280.log`, `api-idp284.log`,
  `api-executor289.log`, `api-scim-locale291.log` (reproduced defect),
  `api-scim-locale292.log` (fixed). Work is still in progress; these results do not establish
  that every remaining project gap has been closed.

### October 4 continued verification (09:55; still in progress)

- A complete run (`320-api-coverage.log`) passed 1,552 tests in 132 files. Statements
  87.56%, lines 89.96% and functions 85.93% passed the unchanged 85% gates; branches
  80.94% remained below the threshold. Later run `333-api-coverage.log` measured branches
  82.74% and three passing coverage gates but still failed one outbox assertion, so it
  is not a successful full verification.
- Real CASL delegation tests reproduced a service-client permission escalation: a
  field-specific inverted rule was omitted by `rulesFor` without a field. Delegation
  now examines `possibleRulesFor` including field restrictions. Twenty credential,
  certificate binding, permission delegation and optimistic-update tests pass.
- Collaboration hooks use the real Hocuspocus server and Yjs document with only listener
  startup disabled. Twenty cases pass for tenant bindings, draft access, snapshot replay,
  linked content, presence ownership, lease loss, persistence and recovery after failed flush.
  These local tests do not replace the user-deferred two-user staging acceptance.
- The real Redis session/ticket suite passes 26 cases: SAML session-index logout, subject
  logout, encrypted-record corruption and AAD isolation, public-id termination, refresh
  without resurrection, lock ownership, single-use realtime tickets, browser binding and
  origin/expiry checks. The separate Engage encrypted-store suite passes six cases.
- OIDC tests use real EdDSA signatures and openid-client. Signed logout events containing
  null or arrays were incorrectly accepted. They are now rejected; all 14 new cases pass.
- Analytics metrics pass 15 tests, version-diff tests pass 15 cases, HubClient passes
  12 signed transport cases, Engage linking passes 17 cases, SCIM passes 28 HTTP/real-PG
  cases and integration service boundaries pass 19 cases. Runtime engine passes 62 cases,
  including 15 handoff tests rejecting unpermitted, PII/PCI and nonpersisted variables.
- Outbox dedupe intermittently failed when comparing a shared stream subject count.
  The test now observes the real JetStream acknowledgement for the replayed event id,
  so unrelated tenants cannot affect the assertion. Full-run verification is still pending.
  An isolated retry also hit a Testcontainers port-binding timeout before tests started;
  it is recorded as infrastructure failure, not a passing run.
- Latest logs are under `/tmp/verbis-verification/` with numeric prefixes 309–338.
  Full coverage and final repository checks remain open; live acceptance remains deferred.
