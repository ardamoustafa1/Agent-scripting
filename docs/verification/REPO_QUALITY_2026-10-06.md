# Repo and quality gates — 2026-10-06

Scope: K-01, K-04, K-05, K-08, T-02, T-11, T-12 and T-13 in AUDIT_REPORT.md.

## Changes

- Vault Transit stream chunks enter as `unknown` and pass a discriminated Zod schema before size accounting or buffering. Existing timeout, 64 KiB response limit, token-file permissions and cancellation remain enforced. A malformed stream regression failed before the fix and passes after it.
- Fix strict locale inference, import ordering and void callbacks. Verification tests now participate in root test lint/typecheck, with Nest decorator configuration and explicit API test dependency resolution.
- Default browser commands select Chromium fixtures explicitly. Real `live`, Keycloak, production-header and Agent performance projects have distinct required lanes. Critical lanes reject empty, malformed, skipped and failed test reports.
- PR/main CI calls reusable real-infrastructure and live acceptance workflows. Both also run nightly; signed release publication depends on both. Live preflight requires synthetic SSO states, SAML IdP settings and an active multi-page `AGENT_E2E_SESSION_ID`. Missing configuration fails before browser execution. Configure the disposable `test-staging` environment before enabling release delivery.
- All nine audit specs are wired into `pnpm test:verification`, including actual PostgreSQL/Redis/NATS, Keycloak OIDC and SAML, Vault Transit, SIEM TLS, WebSocket recovery, real browser launch → runtime → outcome → audit/ACK and performance budgets. The isolated Agent flow enforces 1500 ms cold / 500 ms warm render and 100 ms page transitions across Chromium, Firefox and WebKit.
- Update audit fixtures for required campaign selection and a passing saved regression; wait for the selected collaboration rule to render before editing it. Assertions and convergence/performance budgets remain unchanged.
- Acceptance runs now write new observations under `reports/verification`. Generated `artifacts/` and dependency audit output stay on disk and are excluded from source control and formatting.
- Pre-commit credential detection uses mandatory gitleaks and its narrow reviewed source exceptions. File-type prohibitions remain separate. Positive canaries prove actual private keys/API keys still fail, including exception paths.
- Add release-reference, scenario-timeout, audit scalar/JSON and Agent recovery boundary tests to preserve existing coverage floors. A takeover regression exposed a repeated runtime start; the controller now atomically restores the authorized server cursor/history without replaying external commands.
- Regenerate the docs-site API reference before its unit tests, preventing a stale copy from passing through the build-only generator.
- Initialize Conventional Commit history in logical tooling, core, API, connector, web, acceptance and documentation snapshots. These commits capture the current work; they do not reconstruct earlier authorship or dates.

## Verification and remaining acceptance

Local lint (33/33 tasks), typecheck (32/32), harness lint/typecheck, format, build (19/19) and full test (32/32; 25 cached tasks) pass. API has 1888 passing tests, Agent 145 and core-runtime 131. The mandatory coverage gate passes all 18 workspaces without changing thresholds. Security-critical API line coverage is launch 96.69%, authz 98.98%, audit 95.66%, transport 100% and IdP egress 100%.

The final isolated acceptance run passes **345/345 tests across all nine specs, with zero skips**. Real Agent flow measurements are:

| Browser | Cold render (ms) | Warm render (ms) | Page transition (ms) |
|---|---:|---:|---:|
| Chromium | 199 | 171 | 18.4 |
| Firefox | 264 | 248 | 23 |
| WebKit | 437 | 218 | 24 |
| Budget | 1500 | 500 | 100 |

The final default Chromium/axe lane passes **320/320 browser tests with zero skips** (Admin 22, Agent 35, Designer 251, docs 12; 23/23 Turbo tasks, 19 cached).

Detailed results are recorded in the dated PROGRESS entry and evidence manifest. Initial failing runs and intermediate harness failures are retained separately from final passes.

There is no Git remote configured. GitHub Actions, branch protection and external staging secrets/variables cannot be verified from this checkout. K-01 therefore remains partially open; K-08/T-02/T-12/T-13 have executable mandatory gates, but remote acceptance is still pending. PROGRESS statuses use that distinction and retain earlier dated notes as history.

Authentication states are ephemeral files and are removed by the live workflow. Live authentication traces/screenshots/HTML reports are not uploaded. Isolated audit artifacts use synthetic tenants and credentials.
