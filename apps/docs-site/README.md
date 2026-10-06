# Verbis documentation (TR / EN)

Astro + Starlight, static output, Pagefind search, built-in theme/language controls.

```sh
pnpm install --frozen-lockfile
pnpm --filter @verbis/docs-site... build
pnpm docs:dev
```

Routes: `/tr/` and `/en/`; development port 5176. REST pages and downloadable OpenAPI are generated
from the committed `apps/api/openapi.json`. Component/function reference is generated from the
trusted package registries. Regenerate after changing those contracts (`pnpm docs:generate`).
No app imports another app: generators read the OpenAPI artifact and connector Markdown as data.
`DOCS_SITE_URL` sets the canonical deployed HTTPS URL (never put credentials in it).

Capture real images only against an isolated, authenticated demo environment:
`DOCS_CAPTURE_ALLOWED_ORIGINS`, `DOCS_CAPTURE_MANIFEST`, `DOCS_CAPTURE_AUTH_DIR` and `pnpm docs:capture`.
The capture manifest maps each guide step to a URL, ready selector and storage-state file.
Auth states remain outside the repo, screenshots must contain synthetic demo data, and captures
must be reviewed before replacing labelled schematic guide assets. No screenshots, browser tests,
seed, or documentation builds were executed during authoring.

`pnpm --filter @verbis/docs-site test` checks TR/EN route parity, built-in expression examples,
OpenAPI artifact parity and screenshot-capture safety. `pnpm --filter @verbis/api test:unit`
includes demo fixture and target-guard tests. These commands are documented, not executed.

Copy `scripts/capture-manifest.example.json` outside the repository and replace URLs with prepared
step views (canvas, rule, flow, publication, agent wrap-up). `main` is only a placeholder readiness
selector: replace it with a selector proving the intended view is loaded. Save separate TR/EN
storage states after SSO and language selection. No click or login automation runs in the capture
command. Capture writes ignored PNGs under `public/guides/captured/`; review for synthetic-only
content, then move approved assets into `public/guides/` and update the Markdown image links.
The first-script guide currently contains labelled SVG schematics; actual screenshots remain pending.

```sh
DOCS_CAPTURE_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174 \
DOCS_CAPTURE_MANIFEST=/private/demo-capture/manifest.json \
DOCS_CAPTURE_AUTH_DIR=/private/demo-capture/auth pnpm docs:capture
```

Browser installation, SSO sessions and prepared page state are prerequisites for this opt-in command.
No auth state or secret belongs in the repository. User-facing docs must be rebuilt before deployment
when OpenAPI, registry metadata or connector configuration changes.
