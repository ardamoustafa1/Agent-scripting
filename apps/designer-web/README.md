# Designer workspace

The Studio shell uses the existing same-origin cookie BFF, serialized CASL permissions and API authoring resources. It includes a narrow rail, tenant/environment context, global command palette, notification empty state, account menu, theme/language controls, first-use tour, searchable/filterable virtual tables and card views. Campaign detail shows assignments, priorities, basis-point A/B weights, validity windows and external mappings. Script detail displays actual version states and a variable dictionary without variable values.

## Run

```sh
pnpm --filter @verbis/authz build
pnpm --filter @verbis/i18n build
pnpm --filter @verbis/ui build
pnpm --filter @verbis/shared-types build
pnpm --filter @verbis/designer-web dev
```

Set `API_INTERNAL_URL` in the root environment to the API/BFF service. Vite proxies `/api` without a SPA fallback. SSO discovers IdPs through `/auth/discover` and navigates to the fixed `/auth/login?app=designer&returnTo=/` route. Tokens remain server-side; mutations send the session CSRF header and stable per-payload idempotency keys. No API calls execute client-supplied script logic or launch runtime screens.

The shell fetches `/auth/session` and `/v1/me/permissions`; denied routes and creation actions fail closed. Server CASL/ABAC authorization remains authoritative. Permissions/session are refreshed every minute. Workspace query keys include tenant, user and BFF session identity, preventing reuse across principal changes. Logout clears the QueryClient. No private API payloads are stored in browser storage. Only theme and tour completion preferences persist.

## Environment and tenant switching

Root environment configuration accepts:

```
DESIGNER_ENVIRONMENT=dev
DESIGNER_DEV_URL=http://127.0.0.1:5173/
# DESIGNER_TEST_URL=https://studio-test.example.com/
# DESIGNER_PROD_URL=https://studio.example.com/
```

Environment selection navigates to an administrator-configured deployment URL and establishes that deployment's own SSO session. Unconfigured destinations are disabled. URLs must be HTTPS (HTTP only on localhost), have no credentials/query/fragment and point to a deployment root. The selector never changes an API tenant/environment by sending an untrusted header. Without an explicit override, production builds use `prod` and development uses `dev`. Set `DESIGNER_ENVIRONMENT=test` for test deployments.

The current tenant is fixed by the authenticated session. Switching organizations signs out first and uses the other organization's SSO discovery/login; there is no client-selected tenant override. The tenant dialog explains this flow. A future organization picker needs a server-authorized membership/switch contract.

## API and routing

```sh
pnpm --filter @verbis/designer-web api:generate
pnpm --filter @verbis/designer-web build
pnpm --filter @verbis/designer-web analyze
```

OpenAPI types are generated from committed `apps/api/openapi.json` using openapi-typescript. The generator provides a direct recursive JSON alias because TS6 rejects indexed property self-reference. Generated declarations are excluded from style lint, but still typechecked; regeneration does not run tests. Runtime Zod validation remains mandatory for responses. `openapi-typescript@7.10.1` declares a TS5 peer range; generation/typechecking were checked with this repo's TS6.

Every route page is a literal React.lazy import behind Suspense and a route error boundary. No dynamic user-selected imports occur. `analyze` writes `dist/bundle-analysis.html` with gzip/Brotli sizes. Production hosting must serve SPA route fallback for authoring paths and keep `/api` failure responses separate.

## Current API boundaries

- Campaign/script/shared-screen/template/data-source lists use actual endpoints with cursor loading where available. Name/tag/status/owner filters apply to loaded rows; load more expands the searchable set.
- Campaign and script resource DTOs currently omit owner IDs. Their owner column shows “Unspecified”; the “Owned by me” filter only matches explicit owner metadata. Version ownership uses the actual `createdBy` field. No owner or publication state is guessed.
- Script metadata `active` is displayed as Active; draft/review/published are displayed from version `state`, never inferred from metadata status.
- Variables and Releases first select a script, then open its authorized authoring details. This shell does not implement the separate canvas, approval mutation workflow or cross-script release inbox.
- Notifications show an honest empty state: no server notification feed exists yet. Screens/templates/integrations can be listed, but editing these resources belongs to their subsequent dedicated tools.
- Tenant administration settings and server environment infrastructure remain outside this shell. No new HTTP endpoint or database mutation protocol was added. Create operations reuse existing audit/outbox-backed APIs.

## Tests (explicit only)

```sh
pnpm test:designer --typecheck
pnpm test:designer --typecheck --e2e
```

Unit tests cover cookie/CSRF/idempotency transport, schema rejection, SSO routing, permission gates, list/card/filter behavior, command palette and campaign details. Playwright uses synthetic API fixtures and defines axe checks for all three themes, cards, keyboard navigation and campaign mappings. Tests, browser sessions and axe scans were deliberately not run in this task; accessibility and visual acceptance remain unverified.

## Visual screen editor

Open a script version at `/scripts/:id/versions/:number/edit` (authenticated authoring route).
The script detail page links to the latest version. Drafts are editable; immutable versions and
linked shared pages are read only. The editor uses the component registry, the common runtime
renderer, virtual layers, CodeMirror and schema tree helpers. Copy/paste is local to the editor.

Keyboard: Ctrl/Cmd+Z, Shift+Z/Y, C/V, D, G/Shift+G; Delete; Escape selects the parent. Layer
arrows navigate; Alt+Up/Down reorder siblings. Palette insert buttons provide a keyboard path.
Style widths and visual gap/padding controls use schema tokens, not arbitrary CSS values.

Autosave waits 800 ms and requires a valid document. PUT uses CSRF and the current ETag;
conflicts stop saving. A failed request can be retried explicitly. Shared links keep their pinned
version and mode on every save; the impact list follows paginated campaign assignments.

Test source: `src/editor/store.spec.ts`, `e2e/editor.spec.ts`, API DTO regression tests and
core renderer decoration coverage. Commands **for later execution**:

```sh
pnpm --filter @verbis/designer-web exec vitest run src/editor/store.spec.ts
pnpm --filter @verbis/designer-web exec playwright test e2e/editor.spec.ts
pnpm --filter @verbis/api test:unit src/modules/scripts/scripts.dto.spec.ts
```

No tests or browser previews were run for this implementation. Browser layout, axe and drag
frame-budget assertions must be verified before considering the acceptance criteria complete.

### Flow, rule and variable editors

Open an editable script version and choose Screen / Flow / Rules / Variables. All views share
one draft, history and autosave. Flow includes conditional/else and data-source success/error
connections, ELK layout, draggable groups, notes, minimap, zoom and live validation badges.
Use X/Y controls for keyboard positioning; double-click a Page to open its screen.
Import script as subflow asks for a permitted script ID and pinned version; source changes do
not propagate, and dependency conflicts abort the copy. Existing pages can be reused by
subflow Page nodes. New drafts use schema 1.1.0; legacy versions migrate on loading.

Rules use nested AND/OR, typed fields and operators, with expression conversion preserving
unsupported expressions. Assignment conditions in campaign detail use the same builder and
audited optimistic PATCH. A/B conditions target assignment eligibility before selecting a variant.
Variables show definition, classification, defaults and reference locations. Rename updates all
known references in one transaction; dynamic references and linked screens require resolution.

New unit and Playwright flow/a11y scenarios are included in the existing test commands. Tests
and browser previews were deliberately not executed. See ADR-0025 for persistence and limits.

### Integration authoring

Open Integrations for protocol, environment, process-local health and expandable script consumers.
Create opens the import tab: choose REST/SOAP/GraphQL, then import cURL or bounded OpenAPI JSON/YAML.
For SOAP/GraphQL, configure and save the endpoint first; WSDL and sandbox introspection use server APIs.
Request templates use `{{input.field}}`. Authentication uses metadata-only secret selectors; Replace
accepts a write-only value and never retrieves an existing value. The selector supports cursor pagination for metadata.

Schema inference starts with a synthetic sample. Mark PII paths and leave conservative PII masking
on unless responses are classified public. Mapping supports drag/drop and a keyboard source/target
selector; advanced JSONata and request mapping evaluate through the server. Turn on Live mock
mapping preview for debounced, redacted, audited draft previews. Console offers persisted live
sandbox tests, mock scenario selection and ten memory-only trace entries.

Profiles are shown side by side. Save dev/test changes before requesting prod promotion with a
reason; a separate user with approve:Integration reviews the pinned profile and confirms approval.
Shared mapping/request/policy changes remain definition-wide. Existing PUT clients must send
If-Match after GET. Production live testing is refused. Unsaved navigation is guarded.

Tests and Playwright three-theme axe scenarios are written in the existing test commands, but were
not executed per the user's instruction. See ADR-0026 for migration and operational limits.
