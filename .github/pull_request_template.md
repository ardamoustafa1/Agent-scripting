## Summary

<!-- What changed and why. Link the PROGRESS step / ADR. -->

## Definition of Done (CLAUDE.md §10)

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green (plus `pnpm e2e` for UI changes)
- [ ] Audit events emitted for new domain mutations
- [ ] i18n keys added (tr + en)
- [ ] OpenAPI updated; RFC 7807 errors used
- [ ] Docs/ADR updated if architecture or contracts changed
- [ ] `docs/PROGRESS.md` updated
- [ ] No secrets, no PII in logs/fixtures

## Craft review (UI changes; [DIFFERENTIATORS §0.1](../docs/DIFFERENTIATORS.md#01-apple-seviyesi-ne-demek-ölçülebilir))

- [ ] **Clarity:** one primary action per screen
- [ ] **States:** empty, loading, error and partial states are designed (not just the happy path)
- [ ] **Forgiving:** the change is undoable or previews destructive effects first
- [ ] **Speed:** interaction feels instant (INP p75 < 100 ms; no layout shift on open/close)
- [ ] **Motion:** uses `--vb-motion-*` / `--vb-ease-*` tokens; respects `prefers-reduced-motion`
- [ ] **Consistency:** `@verbis/ui` components and tokens only; no ad-hoc colors or spacing
- [ ] **Accessibility:** keyboard path, visible focus, 24×24 targets, no color-only meaning, axe clean in light/dark/high-contrast
- [ ] **Layout:** checked at 320, 768 and 1440 px; no horizontal scroll
- [ ] **Copy:** plain, specific TR and EN text; tells the user what to do next
- [ ] Screenshots (before/after) attached; visual baselines updated on purpose
