import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Runtime, ScriptRenderer, runScenario } from '@verbis/core-runtime';
import { createI18n } from '@verbis/i18n';
import { ScriptDocumentSchema, TestScenarioSchema } from '@verbis/script-schema';
import * as templates from '@verbis/script-schema/templates';
import { UiProvider } from '@verbis/ui';

import { createComponentRegistry } from './catalog.js';

// Stubs and restores only matchMedia: the shared setup's ResizeObserver stub must survive.
const matchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});
afterEach(() => {
  cleanup();
  if (matchMedia) Object.defineProperty(window, 'matchMedia', matchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
});

const documents = Object.entries(templates).flatMap(([name, value]) =>
  typeof value === 'object' && 'pages' in value
    ? [[name, ScriptDocumentSchema.parse(value)] as const]
    : [],
);

// Scenarios only walk the paths they script; a page nobody scripted can still fail to render
// (an unknown expression function, a card variable on a plain input). Built-in templates are the
// first thing a new team opens, so every page must render with the full component registry.
describe.each(documents)('built-in template %s', (_name, document) => {
  it.each(document.pages.map((page) => [page.name, page.id] as const))(
    'renders page %s without a failed component',
    async (_label, pageId) => {
      const failures: string[] = [];
      const runtime = new Runtime({
        document,
        registry: createComponentRegistry(),
        simulation: true,
        session: { agent: { firstName: 'Synthetic' } },
        ports: {
          sessionEvent: (event) => {
            if (JSON.stringify(event).includes('VERBIS_COMPONENT_FAILED'))
              failures.push(event.node ?? JSON.stringify(event));
          },
        },
      });
      runtime.store.set('runtime.page', pageId);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        render(
          <UiProvider i18n={await createI18n('tr')}>
            <ScriptRenderer runtime={runtime} autoStart={false} />
          </UiProvider>,
        );
        expect(failures).toEqual([]);
      } finally {
        error.mockRestore();
        runtime.dispose();
      }
    },
  );
});

it('reads the credit card offer and summary as the agent says them', async () => {
  const document = ScriptDocumentSchema.parse(templates.creditCardSalesScript);
  const runtime = new Runtime({
    document,
    registry: createComponentRegistry(),
    simulation: true,
    session: { variables: { cardProduct: 'gold', creditLimit: 30000 } },
    ports: { sessionEvent: () => undefined },
  });
  runtime.store.set('runtime.page', 'offer');
  try {
    const view = render(
      <UiProvider i18n={await createI18n('tr')}>
        <ScriptRenderer runtime={runtime} autoStart={false} />
      </UiProvider>,
    );
    expect(view.container.textContent).toMatch(
      /Gold kartınız için (₺30\.000,00|30\.000,00 ₺) limit/,
    );
    expect(view.container.textContent).not.toContain('gold kartınız');
    view.unmount();
    // The summary repeats the same amount and product name.
    runtime.store.set('runtime.page', 'summary');
    const summary = render(
      <UiProvider i18n={await createI18n('tr')}>
        <ScriptRenderer runtime={runtime} autoStart={false} />
      </UiProvider>,
    );
    expect(summary.container.textContent).toMatch(
      /Gold kart başvurunuz (₺30\.000,00|30\.000,00 ₺) limitle/,
    );
  } finally {
    runtime.dispose();
  }
});

// Template scenarios may not hold personal values (card digits, income), so the document's own
// scenarios stop at verification. This walks the whole sale with the same scenario engine.
it('completes a credit card sale from greeting to the recorded outcome', async () => {
  const scenario = TestScenarioSchema.parse({
    id: 'cardSaleCompletes',
    name: 'Verified customer accepts the offer and gives consent',
    synthetic: true,
    context: { agent: { firstName: 'Synthetic' } },
    dataSources: {
      customerLookup: {
        kind: 'success',
        outputs: { fullName: 'Synthetic Customer', segment: 'retail' },
      },
      creditScore: { kind: 'success', outputs: { score: 720, approvedLimit: 30000 } },
    },
    steps: [
      { type: 'event', node: 'btn-welcome-next', event: 'onPress' },
      { type: 'variable', variable: 'cardLast4', value: '1234' },
      { type: 'event', node: 'btn-verify', event: 'onPress' },
      { type: 'variable', variable: 'monthlyIncome', value: 45000 },
      { type: 'event', node: 'btn-needs-next', event: 'onPress' },
      { type: 'event', node: 'btn-offer-accept', event: 'onPress' },
      { type: 'variable', variable: 'consentGiven', value: true },
      { type: 'event', node: 'btn-consent-next', event: 'onPress' },
      { type: 'event', node: 'btn-finish', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'SALE_OK' },
  });
  const result = await runScenario(
    templates.creditCardSalesScript,
    createComponentRegistry(),
    scenario,
  );
  expect({ passed: result.passed, code: result.code }).toEqual({ passed: true, code: undefined });
});

// ADR-0055: an author can mark branch fields plainly required. Every branch still completes,
// because a completing outcome owes only the pages the call showed.
it('completes every insurance branch with plainly required branch fields', async () => {
  const document = structuredClone(templates.insuranceRenewalScript);
  let stripped = 0;
  const walk = (node: {
    requiredWhen?: unknown;
    props?: Record<string, unknown>;
    children?: unknown[];
  }) => {
    if (node.requiredWhen) {
      delete node.requiredWhen;
      node.props = { ...node.props, required: true };
      stripped += 1;
    }
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  for (const page of document.pages) walk(page.layout as Parameters<typeof walk>[0]);
  expect(stripped).toBeGreaterThan(0);
  const results = await Promise.all(
    templates.INSURANCE_SCENARIOS.map((scenario) =>
      runScenario(document, createComponentRegistry(), TestScenarioSchema.parse(scenario)),
    ),
  );
  expect(results.map((result) => [result.id, result.passed, result.code ?? null])).toEqual(
    templates.INSURANCE_SCENARIOS.map((scenario) => [scenario.id, true, null]),
  );
});

// M-Z6 keeps an empty value visible; the agent reads what is missing, not a code name.
it('names missing values in words the agent understands', async () => {
  const document = ScriptDocumentSchema.parse(templates.creditCardSalesScript);
  const runtime = new Runtime({
    document,
    registry: createComponentRegistry(),
    simulation: true,
    ports: { sessionEvent: () => undefined },
  });
  const i18n = await createI18n('tr');
  try {
    for (const [page, expected] of [
      ['welcome', 'ben [ajan adı].'],
      ['verify-identity', '[müşteri adı], güvenliğiniz için'],
    ] as const) {
      runtime.store.set('runtime.page', page);
      const view = render(
        <UiProvider i18n={i18n}>
          <ScriptRenderer runtime={runtime} autoStart={false} />
        </UiProvider>,
      );
      expect(view.container.textContent).toContain(expected);
      expect(view.container.textContent).not.toMatch(/\[(agent|name)\]/);
      view.unmount();
    }
  } finally {
    runtime.dispose();
  }
});
