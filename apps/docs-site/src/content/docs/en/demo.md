---
title: "Demo preparation"
---

Run `pnpm seed:demo` only against an isolated local development database. It never deletes/updates
other tenants, refuses production/remote databases and never rewrites an existing demo bundle.
Users have example.invalid addresses and fixture identities; no passwords/tokens are created.
Map their SSO identities in your demo IdP. Campaigns: credit card, tariff upgrade, collections, survey.

Services are mocks with no real customers/production requests. In admin simulator, use `demo-agent-1`
and a demo queue, then autoConnect or Connect. Authored scenarios are in `prisma/demo/scenarios.json`.
Seed was not executed during authoring. Analytics should filter DEMO_DATE and the preceding six days
for synthetic completed/abandoned outcomes. Repository `docs/DEMO.md` contains the three-minute talk track.
