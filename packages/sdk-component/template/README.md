# Component bundle

Run `pnpm install`, `pnpm build`; tests only run explicitly with `pnpm test`. Copy `dist/component.js` and `dist/component.manifest.json` to the tenant-reviewed artifact service. This template is intended for a Verbis workspace (`workspace:*`); when the SDK is published, replace workspace dependency ranges with the approved published versions. No SDK packages are currently published by this scaffold.

The module is standalone and imports no authenticated host code. Bundle CSS inline; external chunks/assets/network calls are blocked by the sandbox CSP. The host loads an approved HTTPS URL, verifies SHA integrity, creates an opaque iframe and transfers one MessagePort. `connectGuest` exposes only emit/write/resize. Use public-only props. Keep translated strings in TR/EN catalogs. Tenant enablement and publisher review are mandatory before registering this artifact.
