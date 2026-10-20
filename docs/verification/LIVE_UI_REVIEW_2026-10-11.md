# Live UI review — 2026-10-11

Local review of Designer, Agent, Admin and Docs on the working tree based on `6c16e43`. This is local acceptance evidence, not production certification or a measured comparison with Awaken.

## Corrections

- Template creation now carries the selected campaign through the UI, API schema and transactional script creation. Scoped designers can open the resulting draft. Missing scope still fails closed. Template POST retries use `Idempotency-Key`.
- AI drafts require a permitted campaign and explicit acceptance. Failed version persistence can retry the same script and idempotency key. The UI only navigates after persistence succeeds and clears the previous retry error.
- Long AI output has a bounded, keyboard-scrollable preview instead of expanding the page indefinitely.
- Preview controls and the device stage stack at 390/768 px. The previous rule was overwritten by a later desktop rule.
- Collaboration status remains visible at laptop widths; the join control wraps within the mobile workspace.
- Rejected scenario recordings now explain the recording restriction inside the open dialog, in Turkish and English. Sensitive input recording remains prohibited; a synthetic-data checkbox does not override classification.
- Admin simulator fixtures use the API's actual top-level connector `kind`. Product audit navigation expectations match the current role rules; desktop editor tests use the visible mode buttons.
- Admin branding contrast checks wait for both the dialog and backdrop to finish appearing, without disabling contrast checks or increasing acceptance budgets.
- Production dependency scanning found two moderate advisories. Pinned `postcss-selector-parser` to 7.1.6 for [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf). Mammoth's CLI now resolves `argparse` 2.0.1, removing its `sprintf-js` dependency affected by [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Regression checks exercise CLI help without loading the formatter and the actual Docs nested CSS chain with a 400 KB flat selector. No advisory was suppressed.
- Script detail visual fixtures now return an empty branch list and wait for the corresponding empty state. Previously they returned an invalid response and captured either pending state or a delayed error. Main editor visuals require a visible button inside the viewport and compare the viewport capture, retaining an independent raw screenshot; full-page capture omitted the painted inert canvas in this browser version.

## Live browser observations

Used the existing `designer` test account through real Keycloak and BFF sessions, with credentials read from the local `.env` without displaying them. Local Keycloak was moved to port 28080 because the in-app browser's localhost:8080 view did not match the Keycloak service returned by local HTTP checks. Derived dev URLs and seed configuration were refreshed; production authentication controls were not changed.

Created the disposable script **QA · Canlı inceleme · 11 Ekim**, ID `01a12bfb-7567-7672-bb59-73d80b44cde4`, in **Dev smoke campaign**. Verified onboarding forward/back/finish, campaign selection, template creation, layer selection, copy/paste, duplicate/delete, undo/redo, autosave, flow auto-layout/zoom/fit, rules empty state, preview and fullscreen. The temporary pasted button was removed.

Ran the NPS flow using mouse and keyboard: required score disables Next, score 10 chooses the promoter branch, optional reasons lead to comment, synthetic comment submits through preview mocks, and Finish produces `SURVEY_DONE`. No external survey service was called. Sensitive comment recording was correctly rejected; this observation led to the dialog error fix.

Saved **QA 11 Ekim · sentetik giriş** without sensitive inputs. The real API regression check passed **5/5** scenarios, including promoter, detractor, passive and failed submission paths. The draft stayed unpublished. Existing user records were not used for destructive tests.

## Verification

The mobile stacking, missing collaboration badge and clipped join control were reproduced by failing regression assertions before correction. The recording regression also failed before the dialog fix and passed afterwards (12 preview behavior tests).

Local logs, traces and screenshots are retained under `reports/live-review-20261011/` and excluded from commits. Tests keep CSRF, scope, idempotency, axe and overflow assertions enabled.

| Check | Result | Local evidence |
| --- | --- | --- |
| Repository unit/integration | 6,033 Vitest + 4 Docs tests passed; 32/32 tasks succeeded | `test-final-ready.log` |
| Designer browser suite, macOS Chromium | 307/307 passed | `designer-final-ready.log` |
| Reviewed visual references, normal comparisons | 22/22 Linux and 12/12 macOS passed without snapshot updates | `linux-visual-final.log`, `designer-visual-final.log` |
| Real-infrastructure acceptance | 345/345 passed, no pending or skipped tests | `verification-final.log`, `reports/verification/results.json` |
| Admin browser suite | 92/92 passed | `admin-e2e-after.log`, `e2e-interrupted-server.log` |
| Agent browser suite | 45/45 passed | `agent-e2e.log`, `e2e-interrupted-server.log` |
| Docs browser suite | 12/12 passed | `docs-final-ready.log` |
| Build / lint / typecheck | 19/19, 33/33 and 32/32 tasks passed | `build-final-ready.log`, `lint-final-ready.log`, `typecheck-final-ready.log` |
| Verification source lint/typecheck | Both passed | `test-lint-current.log`, `test-typecheck-current.log` |
| Coverage gate | Passed, including security-critical scopes | `coverage-final-ready.log` |
| Policy / deployment / audit checks | 57/57, 12/12 and 3/3 passed | `policy-final-ready.log`, `deployment-final.log`, `audit-final.log` |
| Production dependency audit | Zero reported vulnerabilities | `dependency-audit-final.json` |
| Dependency change validation | 70 AI tests, 4 Docs tests, Docs build, 12 Docs browser tests and 2 new security regressions passed; existing remediation test retained | `ai-dependency-final.log`, `docs-dependency-test.log`, `docs-dependency-build.log`, `docs-dependency-browser.log`, `policy-final-ready.log` |
| Security inventory / quarantine / secret scan | Passed; changed sources had no detected secrets | `security-inventory-final.log`, `quarantine-final.log`, `secrets-final-ready.log` |
| Repository formatting | Passed | `format-final-ready.log` |

Four Genesys Cloud vendor sandbox contracts are explicitly skipped because the vendor sandbox is not configured. They are excluded from the passed count. The 456 application browser tests above use API fixtures; the real API 5/5 scenario check and separate real-infrastructure verification must not be conflated with them.

API line/branch coverage is 93.68%/86.59%; Designer line/branch coverage is 92.28%/81.66%. Floors were not reduced. The initial combined E2E command was interrupted when its temporary preview server stopped; the Designer suite was subsequently run in full against a detached production build server and passed.

The real-infrastructure suite includes 45 role/navigation/collaboration checks and real OIDC/SAML login. Chromium, Firefox and WebKit completed the synthetic agent interaction, page transition, state persistence, reconnect and writeback flow. Cold render measured 245/351/467 ms against the 1,500 ms budget; warm render measured 186/308/214 ms against 500 ms; page transition measured 41.1/24/25 ms against 100 ms. These are local measurements, not staging load results. Detailed timings and screenshots are in `agent-final/` and `product-browser-final/`. The final visible Designer screenshot is `screenshots/live-editor-final.png`.

Linux baselines were rendered with the official Playwright 1.63.0 Noble image. Its first full 307-test run passed 299 and exposed 8 visual failures: 2 editor references predated the compact workbench and 6 script-detail references captured the unsettled branch response. Baselines now cover the reviewed workbench and settled branch state; runtime visibility, overflow and axe assertions remain enabled. All 22 reviewed Linux cases subsequently passed without snapshot updates, including the eight initial failures; the 12 changed macOS cases also passed normally. This is an initial full run plus targeted corrections, rather than a second full Linux run. The whole-repository suite preceded the final dependency overrides; affected AI/Docs tests and Docs build were repeated afterwards.

## Remaining release gates

The Git remote is now configured. Historical GitHub results are available, but they concern older commits, not this working tree. For example, [real infrastructure acceptance](https://github.com/ardamoustafa1/Agent-scripting/actions/runs/38122635450) failed on `bda0582`; [live staging acceptance](https://github.com/ardamoustafa1/Agent-scripting/actions/runs/38130192677) failed before tests with `Missing ADMIN_STATE`.

Investigated the existing `test-staging` GitHub environment, its repository/environment variables and secret names, and deployment statuses. Both variable/secret lists are empty, the latest deployment is failed and has no environment URL. This machine has no Kubernetes context; the available Vercel projects do not include Verbis/Agent Scripting. Deployment examples contain placeholders rather than a usable staging endpoint.

Before production acceptance: provision a disposable staging environment and synthetic SSO fixtures, pass remote CI on the reviewed commit, run required live connector/vendor, load and restore acceptance against that environment, and record dated results. Existing performance/security limits must remain enforced. Awaken superiority requires matched competitor measurements; local test passes alone do not establish it.
