# Clean demo acceptance — authored, not executed

The installer performs frozen install, build, migration, empty-tenant-database guard, seed,
service startup and Playwright. It never mocks auth/API/connector ACK. Seed integration responses
are intentionally synthetic mocks. It does not claim to create the external IdP/mTLS infrastructure.

Prerequisites: a disposable local PostgreSQL `verbis_demo` or `verbis_test` (no tenant rows), Redis,
NATS, isolated Keycloak and a local authenticated mTLS edge for hub → API with trusted certificate
forwarding. Supply complete API/hub environment in an absolute file **outside the repository**.
Application ports 4000, 4100, 5173–5175 must be unused. Browsers must already be installed.

Import `verbis-demo-realm.template.json` into the isolated Keycloak instance, with both
`DEMO_OIDC_CLIENT_SECRET` and `DEMO_SMOKE_PASSWORD` supplied to the Keycloak container environment.
They are `${...}` placeholders, never literal login credentials. Do not mount this realm in the
ordinary shared dev stack. Five demo identities have distinct groups; one synthetic password is
used only for this disposable acceptance fixture. OIDC client is `verbis-demo-bff`.

Required extra settings in the private environment file:

- `DEMO_OIDC_ISSUER=http://localhost:8080/realms/verbis-demo` (adjust isolated local port).
- `DEMO_OIDC_CLIENT_ID=verbis-demo-bff`, operator-provided `DEMO_OIDC_CLIENT_SECRET`,
  `DEMO_SMOKE_PASSWORD`, existing `IDENTITY_ENCRYPTION_KEYS` and API signing/JWKS settings.
- `DEMO_HUB_CERT_THUMBPRINT`: RFC 8705 SHA-256 base64url thumbprint of the real hub client cert.
- `HUB_TENANTS=[{"slug":"verbis-demo","clientId":"019c0000-0000-7000-8000-000000000016"}]`,
  `HUB_API_URL` to the isolated mTLS edge, `HUB_CLIENT_CERT_FILE`, `HUB_CLIENT_KEY_FILE`, `HUB_CA_FILE`,
  `HUB_TRUSTED_JWKS` and API → hub trust/settings. No insecure certificate bypass.
- Correct `DATABASE_URL` owner and `DATABASE_APP_URL` least-privilege role plus ordinary
  REDIS/NATS/API/BFF allowed origins. User secrets and auth states must not appear in source control.

Future authorized execution:

```sh
DEMO_SMOKE=1 DEMO_SMOKE_ENV_FILE=/private/verbis-smoke/env pnpm test:demo-smoke
```

The empty DB guard rejects an already provisioned demo rather than silently reporting a clean
install. It runs inside the seed advisory-lock transaction. No `docker down -v`, existing DB reset
or automatic credential creation is performed. Services started by this installer are stopped in
finally; dependencies remain under the operator's control. Start the isolated dependency topology
with fresh project volumes before the installer. Do not reuse an ordinary development database.

The browser flow signs in real admin/designer/agent contexts, checks all four campaigns and the
welcome in all four pinned versions, drives a survey, validates mocked web-service response,
requires actual simulator `setWrapUp` ACK and checks the audit report's `valid`, `breaks` and
`truncated` fields. Designer and welcome screenshots are attached only after SSO and contain
synthetic data. Trace/video/automatic failure screenshots are disabled to keep auth material out
of reports. Screenshots must still be reviewed before publication.

Approval/publish, SAML, two-browser editing, negative launch tests, load and axe suites remain
separate acceptance gates. The bootstrapped published scripts are not proof of real approval.
