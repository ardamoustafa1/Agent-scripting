# Server-side WebService engine

REST, SOAP and read-only GraphQL requests execute in the API. Agent applications never receive upstream credentials or connect directly to external systems. Definitions reference write-only secrets; SQL read-only and gRPC adapters have the `ExtensionDriver` contract but are not enabled.

## Configuration

- Provision `INTEGRATION_MASTER_KEY` as a base64-encoded 32-byte key. There is no fallback/development key. Listing metadata still works when it is unset; secret operations fail closed. Do not change this key without migrating existing envelopes.
- `INTEGRATION_VAULT` is the Nest provider for `EnvelopeVault`. The default provider uses the environment master key. To use AWS KMS or HashiCorp Vault Transit, replace this provider with an `EnvelopeVault` backed by `AwsKmsAdapter` or `VaultTransitAdapter`, supplying authenticated SDK calls. SDK authentication and remote key lifecycle are deployment responsibilities.
- Each envelope uses a fresh AES-256-GCM DEK. Wrapping binds the key to its tenant; payload AAD binds tenant, secret id and key version. Plaintext buffers and DEKs are zeroed after use. No GET endpoint returns secret values or ciphertext.
- Set tenant `settings.integrationAllowedOrigins` and DataSource `policy.allowedOrigins` to exact origins, e.g. `https://crm.example.com`. Both must match. The default is deny. HTTP also requires `policy.allowHttp`; private, loopback, metadata, link-local, mapped/compatible IPv6 and mixed public/private DNS answers remain denied. DNS is resolved once per request and the socket uses the checked IP. Redirects are disabled. Deployment network policy must additionally deny metadata/internal egress.
- The server chooses `VERBIS_ENVIRONMENT` for runtime execution. `definition.profiles.dev/test/prod` supply alternate base URLs and auth references. A browser-supplied environment cannot change runtime routing.

## APIs

All APIs require the existing authenticated BFF/internal context and CASL authorization; instance checks additionally scope objects to the authenticated tenant. Mutations and secret usage are audited. See the committed OpenAPI document.

| Endpoint                                                | Behavior                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /v1/data-sources`                                 | Create a validated definition; derives secret references from auth/profiles                 |
| `PUT /v1/data-sources/:id`                              | Replace definition and increment version                                                    |
| `POST /v1/secrets`                                      | Set encrypted value; return metadata only                                                   |
| `PUT /v1/secrets/:id`                                   | Rotate value and key version; name/kind stay unchanged                                      |
| `POST /v1/data-sources/:id/preview`                     | Always use mock response; never resolve secrets/DNS or contact upstream                     |
| `POST /v1/data-sources/:id/test`                        | Live dev/test console; production profile is refused                                        |
| `POST /v1/data-sources/:id/wsdl`                        | Parse supplied XML and list binding operations; remote imports/entities are not fetched     |
| `POST /v1/data-sources/:id/introspection`               | Return GraphQL schema for the query editor; dev/test only                                   |
| `POST /v1/sessions/:sessionId/data-sources/:id/execute` | Active, user-owned runtime session; only its declared, pinned DataSource version            |
| `GET /v1/data-sources/:id/metrics`                      | Process-local calls, errors, error rate, rolling p50/p95/p99 milliseconds and breaker state |

Calls accept `{ input, environment }`. Runtime additionally requires `X-Runtime-Session-Token`: an Ed25519 JWT verified against public `INTEGRATION_RUNTIME_JWKS`, issuer `verbis-runtime`, audience `integrations:<tenant UUID>`, `iat`/`exp` and maximum age five minutes. Claims are `sub` (user), `tnt` (tenant), `sid` (runtime session UUID), `bff` (authenticated BFF session id), `scp: "integration:execute"`. The runtime launch/BFF issuer must mint and forward this token; this integration module does not create sessions or issue launch tokens. Its absence fails closed.

Console results contain request structure, response, mapped result, duration, mock/cache flags and a safe error code. Credential/query/header values are always masked. With `containsPii: true` (default), body/response/mapped scalars are masked conservatively; public sources can opt out and designate `piiPaths` using dotted paths. Raw upstream bodies/errors are never logged. Runtime results scrub credential values and secret-like fields before output validation. Sensitive runtime responses bypass the platform idempotency response replay store, so they are not persisted there.

## Protocols, mapping and resilience

- REST endpoint path, query/header and body `{{input.path}}` templates traverse own properties only; path substitutions are URL-encoded. Exact body placeholders preserve JSON types. JSONata request mapping runs before the body template; response mapping runs before JSON Schema validation. Evaluation has time/stack/sequence/step limits. Unsupported output schemas fail closed.
- SOAP requires POST plus namespace, operation and SOAPAction. XML values are escaped; element names are checked; DTD/entities are refused. UsernameToken uses digest, nonce and creation timestamp. WSDL remote includes/imports and SOAP 1.2-specific negotiation are not supported.
- GraphQL requires POST and one configured query operation. Fragments and mutations are refused; depth, fields and parser tokens are bounded. Only the configured server-side query is executed; clients cannot supply arbitrary queries.
- Auth: none, API key header/query, Basic, Bearer, OAuth2 client credentials/password, mTLS, HMAC SHA-256, WS-Security UsernameToken. Structured Basic/WS credentials are secret JSON `{ username, password }`; OAuth secrets contain `{ clientId, clientSecret }` plus username/password for legacy password grant; mTLS secrets contain `{ cert, key, ca? }`. OAuth tokens are cached by tenant/auth/secret version with expiry skew and concurrent refresh coalescing. Rotation or 401 invalidates token caches; expiry triggers a fresh grant (no refresh-token persistence).
- HMAC canonical text is method, path+query, UTC timestamp, nonce and SHA-256 body hash, joined by newlines. Signature is base64 SHA-256 HMAC; timestamp/nonce headers let upstream enforce replay protection.
- Cockatiel applies bulkhead, shared circuit breaker, overall aborting timeout and exponential retry with jitter. Retries apply only to GET/HEAD/PUT/DELETE REST calls and transient network/429/5xx failures. SOAP/GraphQL/POST/PATCH are not retried. Fallback is schema-validated and applies only to transient timeout/breaker/bulkhead/upstream failures, never SSRF, auth, schema or mapping failures.
- Redis caches eligible GET results with TTL. Keys hash canonical input and include tenant, DataSource version, profile, runtime session and credential versions. PII flags, PII paths or sensitive schema tags disable caching. Redis failures bypass cache. Breakers, OAuth caches and percentile samples are per API process; aggregate per-instance metrics operationally. Samples are bounded to 1,000 per source/profile.

## Verification commands (not run in this change)

```sh
# Only the added integration module tests; no Docker dependency.
pnpm --filter @verbis/api test:integrations
# Full API unit test suite.
pnpm --filter @verbis/api test:unit
```

Tests cover auth construction/token refresh via nock, denied targets and DNS rebinding, redirect/response limits, envelope/AAD isolation and adapter contexts, mocked previews, mapping/schema rejection, breaker reset, idempotent retry, timeout, bulkhead, fallback, cache/tenant boundaries, XML/GraphQL hardening, metadata-only secret writes and session token binding. mTLS tests inspect transport credentials; a real certificate handshake and provider SDK integration need deployment integration tests.

## Designer authoring (definition schema 1.1.0)

- Shared Zod contracts live in `@verbis/shared-types`; missing legacy schemaVersion defaults to 1.1.0.
- `GET /v1/data-sources/:id` loads an editable definition. PUT now requires `If-Match: "<version>"`.
- `POST /v1/data-sources/preview` accepts `{ source: SaveDataSource, call: {input,environment,scenario?} }`;
  it uses unsaved mock data, redacts its trace and audits, without secrets/DNS/transport.
- `definition.mockScenarios` defines bounded named success/empty/error/delay responses; `call.scenario`
  is accepted only in previews. Existing single mock definitions remain supported.
- `GET /v1/data-sources/:id/usage` returns readable script consumers plus a truncation flag after
  scanning at most 1000 version rows. This is not a complete reference index for large tenants.
- `POST /v1/data-sources/:id/promotion` requires If-Match and `{from:"dev"|"test",reason}`.
  `POST /v1/data-sources/:id/promotion/approve` requires independent `approve:Integration` permission
  and If-Match. Both audit; requester self-approval and direct prod profile writes are refused.
- A regular save cancels pending review. This workflow promotes base URL/auth profiles; shared
  mapping/request/policy edits still apply across profiles. Assign an independent reviewer through
  tenant permission management. See ADR-0026.
