# @verbis/sdk-component

API for reviewed, versioned partner components. A trusted host registers a descriptor; executable code loads as a separate standalone module into an opaque sandboxed iframe. Script JSON only contains type/version/integrity pins. It never supplies executable code, bundle URLs or tenant identity.

## Create a component

```sh
node packages/sdk-component/cli/create.mjs acme.creditGauge ./packages/acme-credit-gauge
pnpm install --ignore-scripts
pnpm --filter acme-creditgauge build
# Explicitly run the generated unit test only when desired:
pnpm --filter acme-creditgauge test
```

The bin is named `create-verbis-component`. Packages are currently private workspace packages, so the CLI is invoked locally; it is not yet available through a public `npx` distribution. It refuses existing destination directories. The template includes React, Zod, the UI system, TR/EN initialization, a guest bridge, a unit test and a Vite single-file ES-module build. Build computes SHA-384 into `dist/component.manifest.json`; publish that reviewed manifest and `dist/component.js` together. Do not edit deployed bytes after approval.

## Host registration

```ts
import { ComponentPluginHost, registerComponent } from '@verbis/sdk-component';
import { createComponentRegistry } from '@verbis/components';

const registry = createComponentRegistry();
const host = new ComponentPluginHost(authenticatedTenantId, {
  resolve: (type, version, signal) => authenticatedCatalog.resolve(type, version, signal),
});
await registerComponent(host, registry, descriptor);
```

`descriptor` supplies `manifest`, `propsSchema`, `defaults`, `designerMeta` (including property definitions). The schema/metadata are reviewed host code, not executable declarations from untrusted script JSON. The manifest includes namespaced type, exact SemVer, SHA-256/384/512 integrity, composed primitives and explicit public prop/write/event permissions. The schema must accept its defaults. The runtime verifies document pins against the registered descriptor.

The authenticated catalog returns a strict approval containing `tenantId`, `enabled`, matching type/version/integrity, `bundleUrl`, `approvedOrigins` and `expiresAt`. It derives tenant identity from the authenticated session and enforces entitlement and publisher approval. Bundle fetching uses HTTPS, exact origin checks, no credentials, no redirects, CORS, a JavaScript MIME type, a 1 MiB streaming limit and WebCrypto verification before mounting. Configure artifact CORS and host CSP to permit only the reviewed distribution and this iframe strategy.

`host.refresh(descriptor)` refreshes or revokes approval for mounted instances. Expiration removes the frame and closes its capability port. The application should call refresh on entitlement changes; the SDK does not provide a background entitlement subscription.

## Guest API

Import `connectGuest` from `@verbis/sdk-component/guest`. It accepts a Zod props schema and render callback. The callback receives validated public props, TR/EN locale, enabled state and only:

- `write(prop, JsonValue)` for declared, public, two-way bindings.
- `emit(event)` for declared events; the trusted host executes the document's existing action chain.
- `resize(height)` within 24–1200 px.

Initialization transfers one MessagePort to the iframe. Messages are strict, sequential, rate-limited and replay-checked. No arbitrary action payloads, Runtime/store/BFF handles, auth tokens, private variable bindings, expression contexts or server credentials cross the bridge. Only declared props are transferred. Literal props must be public authoring metadata; never put private data in literal props. Incoming writes must satisfy both the host props schema and variable type. Disabled components cannot write or emit.

## Isolation contract

The frame has `sandbox="allow-scripts"` without same-origin/forms/top-navigation permissions. CSP denies connections, external assets, frames, objects, forms and base URLs; it permits only the verified module and inline styling. Bundle all code and CSS into the artifact. No dynamic user-selected imports, eval or host module execution is used. Reloading the guest revokes the channel.

This is DOM/origin/capability isolation, not a CPU/memory resource quota or a complete defense against malicious publisher code. A browser iframe can consume resources and self-navigate; publish only reviewed artifacts and expose only public props. Strong hostile-code containment would require an additional reviewed execution architecture. Test iframe/CSP behavior in the deployment's actual browser and parent CSP before enabling a tenant.

## Tenant enablement on the server

Import `TenantComponentService` from `@verbis/sdk-component/tenant`. Pass authenticated tenant/actor context and command `{ type, version, enabled }`. Its injected `EnablementPorts` authorize first, then find the published exact version and save enablement plus audit in the same transaction. Disable/unpublish must invalidate the catalog approval and trigger host refresh.

Implement this port in the API using tenant-scoped RLS transactions and the existing CASL/audit/outbox services. Audit must add correlation/actor/request context, target, outcome, safe redacted diff and timestamp under the existing audit contract. Rollback on audit failure is the adapter's responsibility. This package supplies the service contract, not a persistence adapter, public HTTP endpoint or publisher portal. Any future endpoint must add OpenAPI and the existing RFC 7807 filter.

## Explicit checks

```sh
pnpm --filter @verbis/sdk-component build
pnpm --filter @verbis/sdk-component typecheck
pnpm --filter @verbis/sdk-component lint
# Test execution remains opt-in:
pnpm test:components --typecheck
```

Tests cover approval pinning, origin/integrity restrictions, the message firewall, private data denial and transactional enablement/audit ordering. Tests were written and not executed in this session.
