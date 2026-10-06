# Studio browser design audit — 2026-10-05

The user requested a browser-led pass through the project to correct overlooked styling, clipping and cramped layouts. This audit covers the **Designer Studio** served at localhost:5173. Navigation used the user's existing Chrome tab through the browser tool, followed by source changes and regression checks. No customer script was published or assigned, no secret was entered, and no external AI request was sent.

## Actual browser coverage

| Area | Views opened and inspected |
| --- | --- |
| All ten navigation destinations | Analytics, Campaigns, Scripts, Screens, Integrations, Variables, AI assistant, Templates, Releases, Settings. Each revisited, screenshot saved, document width checked at the default 1450px viewport. |
| Campaigns | Existing Dev smoke campaign; Settings, Assigned scripts, External mappings; new campaign dialog opened and closed without submitting. |
| Scripts | Existing synthetic QA parcel story detail; Releases and Variables; list and card views; new script dialog opened and closed without submitting. |
| Lifecycle | Campaign assignment form; signed package export/import screen; review/release screen and all five comparison tabs (Screens, Flow, Variables, Data sources, Raw JSON). Existing QA draft remained a draft. |
| Integration editor | New unsaved definition: Import, Request, Schema/PII, Mapping, Resilience, Mock, Test console, Profiles/approvals. All eight tabs opened; affected tabs revisited after fixes. |
| Screen editor | Components, Layers, Pages; selected existing Next button; Properties, Style, Data binding, Events, Rules; keyboard shortcut dialog. |
| Other editor modes | Flow, Rules, Variables, Preview/debugger. Debugger Interaction, Data sources, Variables, Breakpoints, Lint and Scenarios tabs; team/comment panel. No scenario deletion or live collaboration join. |
| Supporting overlays | New tenant template dialog, notifications empty state, global command palette. |
| Responsive | Existing Chrome page at 390px; settings/mobile rail inspected, viewport restored. Automated geometry/axe cases additionally cover 390, 768 and 1440px with three themes. |

The Screens library is empty in the user's current tenant; its empty state was inspected, while populated fixtures and component tests are covered by the browser suite. AI is disabled for this tenant; the disabled screen was inspected. Login/logout and security-sensitive account actions were not exercised in the user's authenticated tab. This is a Studio layout audit, not an audit of every Admin/Agent application or every possible content state.

## Observed defects and corrections

1. Campaign settings used a nearly unstyled full-width fieldset. Added a dedicated token-based stylesheet: white card, field spacing, two columns on wide screens, single column on narrow screens, full-width name/description, separate outcome sections, nested cards, bounded/wrapping buttons.
2. Integration action buttons stretched across the entire editor. Buttons now size to their labels, wrap safely and retain distinct primary/secondary treatment. The create integration link uses the existing button presentation.
3. Request and resilience settings were unnecessarily long single-column forms. Added explicit panel classes, responsive two-column field layout and full-width JSON/auth/help sections.
4. Integration tab content blended into the page; file imports used the browser's unstyled upload control. Added bounded white panels and token-based upload styling. Tabs wrap at narrow widths.
5. Empty mapping columns rendered as blank thin strips. Added visible source/target headings and TR/EN guidance. Long mapping identifiers wrap. Automated axe checks caught skipped heading levels; mapping and profile headings now use the proper level.
6. Back links were plain underlined/visited links. Workspace/lifecycle back links now use a consistent compact navigation treatment, with a decorative CSS arrow that preserves the accessible name.
7. Settings environment badges expanded across their entire container. Badges now keep their natural size; integration profile badges receive the same alignment correction.
8. Mobile/tablet rail labels broke long Turkish menu names into fragments. At <=1100px the narrow rail displays icons with existing accessible names and tooltips; desktop labels remain. Minimum 44px menu targets remain. Debugger tabs now wrap instead of hiding later tabs behind horizontal overflow.
9. Page-heading identity blocks can shrink safely and long titles wrap rather than forcing document overflow.

## Verification

Failing regressions were recorded before fixes: campaign layout 6 failing browser cases; mobile navigation 3 failing / 3 passing cases; empty mapping heading 1 failing / 6 passing unit cases. The expanded all-tab axe check also exposed heading-order violations, which were corrected without suppressing rules.

Final verification: Designer unit/coverage **343/343** in 49 files (statements 89.52%, branches 81.02%, functions 87.33%, lines 91.49%); normal complete Chromium suite **219/219** in 2.4 minutes on the development-mode built artifact. The new nine cases cover all eight integration tabs at 390/768/1440px and light/dark/high-contrast themes. i18n **6/6**; Designer lint/typecheck/format and separate production build passed. Existing large-bundle warning remains. Screenshot tolerances, axe rules, authentication and publication gates were not weakened. Existing 320px/768px visual references were refreshed only for the intentional icon-rail change: 36 images across analytics, editor and script-detail suites. Representative mobile editor and tablet analytics references were visually inspected.

## Evidence

- `artifacts/workspace-design-audit/navigation.json`: ten real Chrome destinations with screenshot filenames and observed document/viewport widths.
- `artifacts/workspace-design-audit/`: main destination screenshots; campaign field layout; integration resilience/mock/mapping; script/campaign/template creation dialogs; release comparison views; mobile settings screenshot.
- `e2e/workspace-forms-layout.spec.ts`: campaign outcome expansion, column geometry, compact rail, eight integration tabs with bounded content and axe, natural-size settings badge; three widths and three themes.
- `src/integrations/list-mapping-behavior.spec.tsx`: empty mapping heading regression alongside existing functional projection tests.
- Raw before/after/build/check logs and source SHA manifest under `docs/verification/evidence/workspace-design-20261005/`.

Browser audit screenshots use synthetic QA/fixture content and local workspace identities. They are evidence of the listed views; they do not establish production capacity, vendor integration correctness or competitive superiority.
