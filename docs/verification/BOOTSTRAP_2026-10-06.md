# Development bootstrap acceptance — 2026-10-06

Scope: K-02, K-03, K-09, K-10, U-06 and the G-07 audit-worker finding.

## Behavior

`pnpm dev:bootstrap` prepares the private local environment and mTLS certificate chain, independent master/pseudonym keys, package signing and runtime/hub trusted JWKS. It starts the Compose services, waits for the core infrastructure, builds before migration/seed, registers the simulator and certificate-bound service client and writes HUB_TENANTS. Repeating bootstrap preserves keys/certificates/IDs. Existing explicit custom settings are preserved; managed connection URLs and origins follow port changes. Keycloak import receives the browser/API port variables.

`pnpm dev` starts API, hub, browser apps, the loopback mTLS edge and the separate least-privilege audit worker. The edge validates the client certificate and replaces its forwarded certificate header. Worker development health is loopback-only. Hub `/health` aliases liveness; readiness still reports queue capacity independently. Bootstrap rejects production and non-loopback API/database/hub settings before changing files.

Generated `.env`/`.dev` material is ignored by Git; key/certificate files have mode 0600 and the TLS directory 0700. This is an explicit development setup; deployed secrets/TLS continue to use the existing production configuration.

## Clean setup verification

`pnpm test:bootstrap` used a disposable source copy without dependencies, dist, generated Prisma, env, certificates or caches, a dedicated Compose project, fresh volumes and unique ports. It executed the README install → bootstrap → dev sequence. A first seed required an empty database. After removing generated Prisma and authz dist output, standalone `pnpm seed` restored both prerequisites and succeeded. The second bootstrap preserved signing/encryption keys and hub identity. It then verified:

- API readiness, hub liveness, worker readiness and three browser health endpoints.
- Actual simulator state through API → JWT-authenticated hub, whose connector config came from API over real certificate-bound mTLS.
- Audit chain `valid: true` with `checkpointsChecked: 1`, proving the running worker signed a checkpoint.
- Keycloak OIDC/PKCE login/logout, secure httpOnly cookie, no tokens in browser storage and axe; 2/2 real browser tests, zero skips.

Cleanup removed only the disposable project and its volumes/temp files. The pre-existing dev stack remained running. The smoke lane is mandatory in CI. Only the safe summary is uploaded; full SSO logs, credentials, certificates and auth/browser traces stay ephemeral or ignored.

## Other checks

Failing-first evidence covers the missing bootstrap module and the hub health alias returning 404. Final bootstrap/mTLS unit tests pass 6/6; hub HTTP 9/9. Root lint 33/33, typecheck 32/32, test 32/32 (30 cached tasks), policy 52/52, format and audit inventory 2/2 pass. Mandatory coverage passes 18 workspaces without lowering thresholds. API has 1888 passing tests and hub 631.

Evidence: `evidence/bootstrap-20261006/summary.json`, final redacted-safe check output and source/artifact SHA256 manifest. Full SSO acceptance logs are intentionally excluded from committed evidence.

Remote GitHub Actions and production acceptance remain unverified because this repository has no remote/run URL. Existing dated reports describe their original snapshots; this report records the subsequent bootstrap changes.
