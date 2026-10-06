# @verbis/components

Shared screen library for designer preview and authorized agent sessions. Both use the same `Runtime`, registry and `ScriptRenderer`. Import `@verbis/ui/fonts.css` and `@verbis/components/styles.css` once in the host application.

## Setup

```tsx
import { Runtime, ScriptRenderer } from '@verbis/core-runtime';
import { createComponentRegistry, ComponentProvider } from '@verbis/components';
import { UiProvider } from '@verbis/ui';
import { createI18n } from '@verbis/i18n';

const i18n = await createI18n('tr');
const runtime = new Runtime({ document, registry: createComponentRegistry(), ports });
// document and ports come from the authenticated launch/session host.
<UiProvider i18n={i18n} theme="light">
  <ComponentProvider
    environment={{
      mediaOrigins: ['https://assets.example.test'],
      knowledgeOrigins: ['https://knowledge.example.test'],
      frameOrigins: [],
      features: [],
      now: Date.now,
    }}
  >
    <ScriptRenderer runtime={runtime} />
  </ComponentProvider>
</UiProvider>;
// On session close: unmount the tree, then runtime.dispose().
```

The application must supply its validated document and authenticated runtime ports. Do not create sessions from query parameters. Designer preview uses `simulation: true` and mock ports. No host credentials enter component props.

## Catalog

Each of the 67 registry types exposes a strict Zod `propsSchema`, defaults, permitted events/bindings, primitive composition, designer icon/category/drop rules and translated property-panel definitions. Exported React wrappers accept core `RendererProps`; the normal integration renders JSON through `ScriptRenderer`. `LIBRARY_DEFINITIONS` is the authoritative catalog. The original small `ComponentRegistry` compatibility export remains available; use `createComponentRegistry()` for the complete runtime registry.

| Category  | Components                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script    | ScriptText, Callout, ObjectionHandler, Checklist, KnowledgeLink; text/heading/richContent/alert aliases                                                                                                                                                       |
| Input     | TextInput, TextArea, NumberInput, CurrencyInput, Select, MultiSelect, RadioGroup, CheckboxGroup, Checkbox, Toggle, DatePicker, TimePicker, Rating, Slider, PhoneInput, EmailInput, MaskedInput, AddressInput, TCKNInput, VKNInput, IBANInput, CreditCardInput |
| Structure | Section, Card, Columns, Tabs, Accordion, Stepper, Wizard, Modal, Divider, Spacer, Repeater                                                                                                                                                                    |
| Data      | Lookup, AutoComplete, DataGrid, KeyValueList, CustomerCard, Timeline, Chart; table alias                                                                                                                                                                      |
| Action    | ActionButton, NextButton, BackButton, ButtonGroup, DispositionPicker, OutcomeSubmit, TransferHint, CallbackScheduler                                                                                                                                          |
| Other     | Image, Video, Iframe, Timer, Countdown, Note, Badge, ProgressIndicator, Signature                                                                                                                                                                             |

All containers compose Box. Action controls compose core Button and its loading/error/action-chain behavior. Data views compose WebService, which delegates authenticated calls to the existing proxy port and publishes mapped outputs. Forms use the design system's keyboard controls, labels, errors and focus styling. CSS uses logical properties and tokens; locales default to TR with matching EN labels.

## Authoring

- Labels and content reference translation keys. Put custom keys in `document.i18n.messages` for each locale. `components.*` and `runtime.*` are platform catalogs.
- ScriptText accepts safe rich blocks (`p`, `strong`, `em`, `mark`, `h3`, `li`) and escaped `{{name}}` / `{{vars.name}}` interpolation. Templates never inject HTML. `mustRead: true` adds acknowledgment and a page/script validation guard. PCI variables cannot be interpolated.
- Input bindings use `{ prop: 'value', variable: 'customerName' }`; input events do not include raw values. MaskedInput accepts only literal separators and `#` digits. AddressInput stores an object. Number/currency fields store numbers and currency metadata; use integer minor units or decimal strings at server money boundaries.
- TCKN/VKN/IBAN/PAN are write-only password controls with format/checksum validation. Raw values remain memory-only and are never rehydrated into the control. Writes raise classification to PII, or PCI for PAN. Secure controls reject `itemPath`, preventing accidental writes into public repeater arrays. Mark variables correctly in the document before the first render. Runtime disposal clears PCI values; the host must avoid persistence/logging of these values and implement server-side authoritative checks.
- Repeater reads `arrayVariable`, requires unique stable string `itemKey` values, bounds rendered rows, clones child IDs and provides `itemPath` writes plus `{{item.name}}` interpolation. PCI arrays are denied. No positional identity.
- Data views reference `ds`, `output`, `queryVariable` and translated columns. Remote AutoComplete uses debounced input observation through WebService. DataGrid delegates virtual scrolling/sorting/filtering/resizing to the UI DataTable. Charts include an accessible data table. No arbitrary URLs or credentials are requested directly by data components.
- Image/Video/KnowledgeLink/Iframe use exact tenant-approved HTTPS origins; the default allowlists deny everything. Video requires captions when configured. Iframe uses an empty sandbox and denies device permissions. Origins are trusted host configuration, never script-authored allowlists.
- CallbackScheduler requires the trusted `scheduleCallback` environment port. This port resolves the supplied tenant-approved timezone, validates availability/future time, performs authorization, persistence and transaction/outbox audit. Signature is disabled unless `features` includes `signature`; it offers pointer drawing and a keyboard typed-name alternative. Legal acceptance remains a server policy.

## Storybook and checks

```sh
pnpm --filter @verbis/components build
pnpm --filter @verbis/components storybook
# Explicit test execution, when requested:
pnpm test:components --typecheck
pnpm test:components --typecheck --a11y
```

Storybook runs on port 6007, with one Default and Disabled story per registered type and light/dark/high-contrast, TR/EN and direction toolbar options. Unit tests cover each schema/registration/render contract and key interactions/security boundaries. Playwright defines an axe check per type per theme plus EN/RTL. Tests and axe checks were deliberately not executed in this implementation session; zero violations and coverage remain unverified. No tests run during installation or build.
