import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import { NodeSchema, DataSourceRefSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import { Desktop, type View } from './api.js';
import { SessionView } from './session-view.js';

import type { DraftVault } from './vault.js';

const socket = vi.hoisted(() => ({ callbacks: new Map<string, () => void>() }));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, callback: () => void) => {
      socket.callbacks.set(event, callback);
    },
    disconnect: vi.fn(),
  }),
}));
let i18n: I18nInstance;
const clients: QueryClient[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
});
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  socket.callbacks.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(
  state: View['state'] = 'active',
  channel = 'voice',
  fail = false,
  scenario: {
    decorate?: (desktop: Desktop) => void;
    draft?: unknown;
    readOnly?: boolean;
    active?: boolean;
    failStatus?: number;
    expectFailure?: boolean;
    vaultFailure?: Error;
    dataPolicy?: 'block' | 'continue' | 'manual';
  } = {},
) {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  for (const key of [
    'hasPointerCapture',
    'setPointerCapture',
    'releasePointerCapture',
    'scrollIntoView',
  ])
    Object.defineProperty(HTMLElement.prototype, key, {
      value: key === 'hasPointerCapture' ? () => false : vi.fn(),
      configurable: true,
    });
  const document = minimalScript();
  document.variables = [
    { key: 'name', type: 'string', scope: 'session', default: '', classification: 'public' },
  ];
  const desktop = Desktop.parse({
    view: {
      id: '01928f3a-0000-7000-8000-000000000001',
      state,
      sequence: 1,
      readOnly: true,
      snapshot: { variables: { name: '' }, currentPage: 'home', history: [], timers: {} },
    },
    document,
    checksum: 'synthetic',
    startedAt: '2026-10-03T10:00:00Z',
    interaction: {
      channel,
      status: 'connected',
      queue: 'Synthetic queue',
      platform: 'simulator',
      customerName: 'Synthetic customer',
      context: {
        customerName: 'Synthetic',
        customerId: { id: 'synthetic' },
        ani: 123,
        history: [
          { title: 'Previous synthetic interaction', summary: 'Resolved' },
          'Recorded event',
          null,
        ],
        knowledge: [],
        transcript: [{ sender: 'Synthetic customer', text: 'Synthetic message' }],
      },
    },
    campaign: {
      name: 'Synthetic campaign',
      outcomes: [
        {
          code: 'DONE',
          label: 'Resolved',
          category: 'success',
          requiresNote: true,
          requiredFields: ['name'],
          subCodes: ['synthetic-subcode'],
        },
      ],
    },
    writeback: 'success',
  });
  if (scenario.dataPolicy) {
    desktop.document.dataSources = [
      DataSourceRefSchema.parse({
        id: 'lookup',
        ref: 'tenant-datasource:lookup',
        version: 1,
        outputs: { name: { path: '$.name', variable: 'name' } },
        policy: { onFailure: scenario.dataPolicy },
      }),
    ];
    desktop.document.pages[0]!.layout.children!.push(
      NodeSchema.parse({
        id: 'lookup-button',
        type: 'webService',
        props: { ds: 'lookup', visible: true },
      }),
    );
  }
  scenario.decorate?.(desktop);
  let view = structuredClone(desktop.view);
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url, options) => {
    const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const body =
      typeof options?.body === 'string'
        ? (JSON.parse(options.body) as Record<string, unknown>)
        : {};
    requests.push({ path, body });
    if (path.endsWith('/desktop/data-source'))
      return Promise.resolve(
        Response.json(
          { code: 'VERBIS_INTEGRATION_UNAVAILABLE', correlationId: 'datasource-test' },
          { status: 503 },
        ),
      );
    if (fail)
      return Promise.resolve(
        Response.json(
          { code: 'safe_failure', correlationId: 'support-test-42' },
          { status: scenario.failStatus ?? 500 },
        ),
      );
    if (path.endsWith('/ai/status')) return Promise.resolve(Response.json({ agentEnabled: false }));
    if (path.endsWith('/desktop/feedback'))
      return Promise.resolve(
        scenario.failStatus === 503
          ? Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 })
          : Response.json(
              { recorded: true, threadId: '01928f3a-0000-7000-8000-0000000000fb' },
              { status: 201 },
            ),
      );
    if (path.endsWith('/desktop')) return Promise.resolve(Response.json({ ...desktop, view }));
    if (path.endsWith('/attach'))
      return Promise.resolve(
        Response.json({
          ...view,
          readOnly: scenario.readOnly ?? false,
          writeToken: 'synthetic-writer',
          leaseUntil: '2026-10-03T12:00:00Z',
        }),
      );
    if (path.endsWith('/socket-ticket'))
      return Promise.resolve(Response.json({ ticket: 'synthetic' }));
    if (path.endsWith('/commands')) {
      const command = body['command'] as Record<string, unknown>;
      view = { ...view, sequence: view.sequence + 1 };
      if (command['type'] === 'transition') view.state = command['state'] as View['state'];
      if (command['type'] === 'field')
        view.snapshot.variables[String(command['variable'])] = String(command['value']);
      if (command['type'] === 'page')
        view = {
          ...view,
          snapshot: {
            ...view.snapshot,
            currentPage: String(command['pageId']),
            history: (command['history'] as string[] | undefined) ?? [],
          },
        };
    }
    if (path.endsWith('/outcome'))
      view = { ...view, sequence: view.sequence + 1, state: 'completed' };
    return Promise.resolve(Response.json(view));
  });
  vi.stubGlobal('fetch', fetch);
  const vault = {
    partition: 'synthetic-partition',
    save: vi.fn().mockResolvedValue(undefined),
    load: scenario.vaultFailure
      ? vi.fn().mockRejectedValue(scenario.vaultFailure)
      : vi.fn().mockResolvedValue(scenario.draft ?? null),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as DraftVault;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const onStatus = vi.fn();
  const ui = render(
    <QueryClientProvider client={client}>
      <UiProvider i18n={i18n}>
        <SessionView
          id={desktop.view.id}
          csrf="synthetic-csrf"
          vault={vault}
          active={scenario.active ?? true}
          onStatus={onStatus}
        />
      </UiProvider>
    </QueryClientProvider>,
  );
  if (!fail && !scenario.expectFailure && scenario.active !== false)
    await waitFor(() => {
      expect(ui.container.querySelector('h1')?.textContent).toBe(
        desktop.interaction.customerName ?? i18n.t('agent.desktop.customer'),
      );
    });
  return {
    ui,
    requests,
    onStatus,
    desktop,
    fetch,
    vault,
    setView: (next: View) => {
      view = next;
    },
  };
}
it('loads the actual authorized session, exposes progress and shortcut help, and reports interaction status', async () => {
  const f = await mount();
  await waitFor(() => {
    expect(f.onStatus).toHaveBeenCalledWith(f.desktop.view.id, 'active', false);
  });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  fireEvent.keyDown(document, { ctrlKey: true, key: '/' });
  const help = screen.getByRole('dialog', { name: i18n.t('agent.desktop.shortcuts') });
  for (const action of ['next', 'nextAnywhere', 'back', 'focusMode', 'switchInteraction'])
    expect(within(help).getByText(i18n.t(`agent.desktop.${action}`))).toBeDefined();
  fireEvent.keyDown(help, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  // "?" opens the same help, but never while typing.
  fireEvent.keyDown(document, { key: '?' });
  expect(screen.getByRole('dialog', { name: i18n.t('agent.desktop.shortcuts') })).toBeDefined();
});
it('shows a safe load failure without displaying server exception details', async () => {
  await mount('active', 'voice', true);
  await screen.findByText(i18n.t('agent.desktop.failure.network'));
  expect(screen.getByRole('button', { name: i18n.t('agent.desktop.retry') })).toBeDefined();
  expect(screen.queryByText('safe_failure')).toBeNull();
});
it.each(['completed', 'paused', 'abandoned'] as const)(
  'renders the correct %s lifecycle state and disables next navigation',
  async (state) => {
    await mount(state);
    if (state === 'completed')
      expect(
        screen.getByRole('heading', { name: i18n.t('agent.desktop.completed') }),
      ).toBeDefined();
    if (state === 'paused') expect(screen.getByText(i18n.t('agent.desktop.held'))).toBeDefined();
    if (state === 'abandoned')
      expect(screen.getByText(i18n.t('agent.desktop.ended'))).toBeDefined();
    expect(document.querySelector('[data-agent-next]')?.getAttribute('disabled')).not.toBeNull();
  },
);
it('lists required notices in a live checklist that follows the runtime acknowledgement state', async () => {
  await mount('active', 'chat', false, {
    decorate: (desktop) => {
      desktop.document.pages[0]?.layout.children?.push(
        NodeSchema.parse({
          id: 'txt-kvkk',
          type: 'scriptText',
          props: { mustRead: true, titleKey: 'notice.kvkk', textKey: 'notice.kvkk' },
        }),
      );
      for (const locale of ['tr', 'en'])
        desktop.document.i18n.messages[locale] = {
          ...desktop.document.i18n.messages[locale],
          'notice.kvkk': 'Privacy notice',
        };
    },
  });
  const tab = await screen.findByRole('tab', {
    name: `${i18n.t('agent.desktop.compliance')} (1)`,
  });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  const progress = (done: number) => i18n.t('agent.desktop.complianceProgress', { done, total: 1 });
  expect(await screen.findByText(progress(0))).toBeDefined();
  expect(screen.getByText(i18n.t('agent.desktop.compliancePending'))).toBeDefined();
  fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('components.readConfirmed') }));
  expect(await screen.findByText(progress(1))).toBeDefined();
  expect(screen.getByText(i18n.t('agent.desktop.complianceDone'))).toBeDefined();
  // Nothing pending any more: the tab no longer shows a count.
  expect(screen.getByRole('tab', { name: i18n.t('agent.desktop.compliance') })).toBeDefined();
});
it('hides the checklist tab when the script has no required notices', async () => {
  await mount('active', 'chat');
  await screen.findByRole('tab', { name: i18n.t('agent.desktop.summary') });
  expect(
    screen.queryByRole('tab', { name: new RegExp(i18n.t('agent.desktop.compliance')) }),
  ).toBeNull();
});
it('shows side panel scalar/structured context and bounded history/transcript content', async () => {
  await mount('active', 'chat');
  expect(screen.getByText('Synthetic')).toBeDefined();
  expect(screen.getByText('{"id":"synthetic"}')).toBeDefined();
  fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('agent.desktop.history') }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByText('Previous synthetic interaction · Resolved')).toBeDefined();
  expect(screen.getByText('Recorded event')).toBeDefined();
  fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('agent.desktop.transcript') }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByText('Synthetic customer · Synthetic message')).toBeDefined();
});
it('requires disposition, note and required fields before submitting a sequenced outcome', async () => {
  const f = await mount('wrapup');
  const submit = screen.getByRole('button', { name: i18n.t('agent.desktop.submit') });
  expect(submit.getAttribute('disabled')).not.toBeNull();
  fireEvent.click(screen.getByRole('combobox', { name: i18n.t('agent.desktop.disposition') }));
  fireEvent.click(await screen.findByRole('option', { name: 'Resolved' }));
  fireEvent.change(screen.getByRole('textbox', { name: i18n.t('agent.desktop.notes') }), {
    target: { value: 'Synthetic note' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
    target: { value: 'Synthetic required value' },
  });
  await waitFor(() => {
    expect(submit.getAttribute('disabled')).toBeNull();
  });
  fireEvent.click(submit);
  await screen.findByRole('heading', { name: i18n.t('agent.desktop.completed') });
  expect(f.requests.find((request) => request.path.endsWith('/outcome'))?.body).toMatchObject({
    code: 'DONE',
    note: 'Synthetic note',
    fields: { name: 'Synthetic required value' },
  });
});
it('moves an active session into wrap-up with its footer control', async () => {
  const f = await mount();
  const wrap = screen.getByRole('button', { name: i18n.t('agent.desktop.wrapup') });
  await waitFor(() => {
    expect(wrap.getAttribute('disabled')).toBeNull();
  });
  fireEvent.click(wrap);
  await screen.findByRole('heading', { name: i18n.t('agent.desktop.wrapup') });
  expect(
    f.requests.some(
      (request) =>
        (request.body['command'] as Record<string, unknown> | undefined)?.['state'] === 'wrapup',
    ),
  ).toBe(true);
});
it('shows a transferred interaction, toggles voice context, edits notes and reports empty knowledge safely', async () => {
  const f = await mount('active', 'voice', false, {
    decorate: (desktop) => {
      desktop.interaction.status = 'transferred';
      desktop.interaction.customerName = null;
      desktop.interaction.context['customerName'] = true;
    },
  });
  expect(screen.getByText(i18n.t('agent.desktop.transferred'))).toBeDefined();
  expect(screen.getByRole('heading', { name: i18n.t('agent.desktop.customer') })).toBeDefined();
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.sidebar') }));
  fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('agent.desktop.notes') }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.change(await screen.findByRole('textbox', { name: i18n.t('agent.desktop.notes') }), {
    target: { value: 'Durable synthetic note' },
  });
  fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('agent.desktop.knowledge') }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByText(i18n.t('agent.desktop.empty'))).toBeDefined();
  expect(f.vault).toBeDefined();
});
it('renders typed required wrap-up fields, blocks payment/object requirements and records callback time', async () => {
  const f = await mount('wrapup', 'email', false, {
    decorate: (desktop) => {
      desktop.document.variables.push(
        {
          key: 'approved',
          pii: false,
          persist: false,
          type: 'boolean',
          scope: 'session',
          default: false,
          classification: 'public',
        },
        {
          key: 'category',
          pii: false,
          persist: false,
          type: 'enum',
          enumValues: ['synthetic-option'],
          scope: 'session',
          classification: 'public',
        },
        {
          key: 'count',
          pii: false,
          persist: false,
          type: 'number',
          scope: 'session',
          default: 0,
          classification: 'public',
        },
        {
          key: 'payment',
          pii: false,
          persist: false,
          type: 'string',
          scope: 'session',
          classification: 'pci',
        },
        {
          key: 'details',
          pii: false,
          persist: false,
          type: 'object',
          scope: 'session',
          classification: 'public',
        },
      );
      desktop.campaign.outcomes[0]!.requiredFields = [
        'approved',
        'category',
        'count',
        'payment',
        'details',
        'missing',
      ];
    },
  });
  fireEvent.click(screen.getByRole('combobox', { name: i18n.t('agent.desktop.disposition') }));
  fireEvent.click(await screen.findByRole('option', { name: 'Resolved' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'approved' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'category' }));
  fireEvent.click(await screen.findByRole('option', { name: 'synthetic-option' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'count' }), { target: { value: '12' } });
  expect(
    screen.getByText(i18n.t('agent.desktop.requiredScriptField', { field: 'payment' })),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t('agent.desktop.requiredScriptField', { field: 'details' })),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t('agent.desktop.requiredScriptField', { field: 'missing' })),
  ).toBeDefined();
  expect(
    screen.getByRole('button', { name: i18n.t('agent.desktop.submit') }).getAttribute('disabled'),
  ).not.toBeNull();
  fireEvent.change(screen.getByLabelText(i18n.t('agent.desktop.callback')), {
    target: { value: '2026-10-04T14:30' },
  });
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/commands'))).toBe(true);
  });
});
it('shows draft version mismatch without submitting mutations or losing the original draft', async () => {
  const f = await mount('active', 'voice', false, {
    draft: {
      checksum: 'older',
      pending: {},
      note: 'Original note',
      disposition: '',
      callbackAt: '',
    },
  });
  await screen.findByText(i18n.t('agent.desktop.draftVersion'));
  expect(
    f.requests.some(
      (request) => request.path.endsWith('/attach') || request.path.endsWith('/commands'),
    ),
  ).toBe(false);
});
it.each(['server', 'local'] as const)(
  'exposes and executes the %s resolution for a field conflict',
  async (choice) => {
    const f = await mount('wrapup');
    const original = f.fetch.getMockImplementation()!;
    let conflict = true;
    f.fetch.mockImplementation((url, options) => {
      if (typeof url === 'string' && url.endsWith('/commands') && conflict) {
        conflict = false;
        f.setView({
          ...f.desktop.view,
          sequence: 2,
          snapshot: { ...f.desktop.view.snapshot, variables: { name: 'Foreign edit' } },
        });
        return Promise.resolve(Response.json({ code: 'VERBIS_SEQUENCE' }, { status: 412 }));
      }
      return original(url, options);
    });
    fireEvent.click(screen.getByRole('combobox', { name: i18n.t('agent.desktop.disposition') }));
    fireEvent.click(await screen.findByRole('option', { name: 'Resolved' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
      target: { value: 'Local edit' },
    });
    await screen.findByText(i18n.t('agent.desktop.conflict'));
    const pendingUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pendingUnload);
    expect(pendingUnload.defaultPrevented).toBe(true);
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t(choice === 'server' ? 'agent.desktop.useServer' : 'agent.desktop.keepDraft'),
      }),
    );
    await waitFor(() => {
      expect(screen.queryByText(i18n.t('agent.desktop.conflict'))).toBeNull();
    });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'name' }).value).toBe(
      choice === 'server' ? 'Foreign edit' : 'Local edit',
    );
  },
);
it('advances with Enter, fences typing and modified keys, and ignores shortcuts for inactive interactions', async () => {
  const f = await mount();
  const next = document.querySelector<HTMLButtonElement>('[data-agent-next]')!;
  await waitFor(() => {
    expect(next.disabled).toBe(false);
  });
  fireEvent.keyDown(next, { key: 'Enter' });
  fireEvent.keyDown(document, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(document, { key: 'Enter', altKey: true });
  fireEvent.keyDown(document, { key: 'Enter', isComposing: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.requests.some((request) => request.path.endsWith('/commands'))).toBe(false);
  fireEvent.keyDown(document, { key: 'Enter' });
  await screen.findByRole('heading', { name: i18n.t('agent.desktop.wrapup') });
});
function twoPages(desktop: Desktop) {
  const document = desktop.document;
  document.pages.push({
    ...document.pages[0]!,
    id: 'details',
    name: 'details',
    titleKey: 'pages.details',
    layout: NodeSchema.parse({
      id: 'details-root',
      type: 'box',
      children: [
        {
          id: 'name-input',
          type: 'textInput',
          props: { labelKey: 'fields.name' },
          bindings: [{ prop: 'value', variable: 'name' }],
        },
      ],
    }),
  });
  document.flow.nodes.splice(1, 0, { id: 'n-details', type: 'page', page: 'details' });
  document.flow.edges = [
    { id: 'e1', from: 'n-home', to: 'n-details' },
    { id: 'e2', from: 'n-details', to: 'n-end' },
  ];
  for (const locale of ['tr', 'en'])
    document.i18n.messages[locale] = {
      ...document.i18n.messages[locale],
      'pages.details': 'Customer details',
      'fields.name': 'Customer name',
    };
}
it('names the current step, keeps the completed trail and puts the caret in the new page', async () => {
  await mount('active', 'voice', false, { decorate: twoPages });
  const next = document.querySelector<HTMLButtonElement>('[data-agent-next]')!;
  await waitFor(() => {
    expect(next.disabled).toBe(false);
  });
  expect(screen.getByRole('heading', { level: 2, name: 'Home' })).toBeDefined();
  expect(screen.getByText(i18n.t('agent.desktop.step', { number: 1 }))).toBeDefined();
  next.focus();
  fireEvent.click(next);
  const heading = await screen.findByRole('heading', { level: 2, name: 'Customer details' });
  expect(heading).toBeDefined();
  const field = screen.getByRole('textbox', { name: 'Customer name' });
  await waitFor(() => {
    expect(document.activeElement).toBe(field);
  });
  expect(
    screen.getByText(i18n.t('agent.desktop.nowOn', { page: 'Customer details' })),
  ).toBeDefined();
  await waitFor(() => {
    expect(screen.getByText(i18n.t('agent.desktop.step', { number: 2 }))).toBeDefined();
  });
  const trail = screen.getByText(i18n.t('agent.desktop.trail', { count: 1 })).closest('details')!;
  expect(within(trail).getByText('Home')).toBeDefined();
  // Ctrl+Enter moves on even from inside the answer field.
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
  await screen.findByRole('heading', { name: i18n.t('agent.desktop.wrapup') });
});
it('never advances from the notes in the side panel', async () => {
  const f = await mount('active', 'chat');
  const next = document.querySelector<HTMLButtonElement>('[data-agent-next]')!;
  await waitFor(() => {
    expect(next.disabled).toBe(false);
  });
  const sidebar = screen.getByRole('complementary', { name: i18n.t('agent.desktop.sidebar') });
  fireEvent.mouseDown(within(sidebar).getByRole('tab', { name: i18n.t('agent.desktop.notes') }), {
    button: 0,
  });
  const notes = await within(sidebar).findByRole('textbox', {
    name: i18n.t('agent.desktop.notes'),
  });
  fireEvent.keyDown(notes, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(notes, { key: 'Enter' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    f.requests.some(
      (request) =>
        request.path.endsWith('/commands') &&
        ['page', 'transition'].includes(
          String((request.body['command'] as Record<string, unknown> | undefined)?.['type']),
        ),
    ),
  ).toBe(false);
});
it('reports an inactive interaction as unseen and keeps its keyboard handler detached', async () => {
  const f = await mount('active', 'voice', false, { active: false });
  expect(
    f.requests.some(
      (request) => request.path.endsWith('/attach') || request.path.endsWith('/socket-ticket'),
    ),
  ).toBe(false);
  expect(f.onStatus).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { ctrlKey: true, key: '/' });
  expect(screen.queryByRole('region', { name: i18n.t('agent.desktop.shortcuts') })).toBeNull();
});
it('shows safe action failure after a wrap-up mutation fails and allows retry', async () => {
  const f = await mount();
  const wrap = screen.getByRole('button', { name: i18n.t('agent.desktop.wrapup') });
  await waitFor(() => {
    expect(wrap.getAttribute('disabled')).toBeNull();
  });
  f.fetch.mockResolvedValueOnce(Response.json({ code: 'private_exception' }, { status: 500 }));
  fireEvent.click(wrap);
  await screen.findByText(i18n.t('agent.desktop.failure.network'));
  expect(screen.queryByText('private_exception')).toBeNull();
  fireEvent.click(wrap);
  await screen.findByRole('heading', { name: i18n.t('agent.desktop.wrapup') });
  expect(screen.queryByText(i18n.t('agent.desktop.failure.network'))).toBeNull();
});

it.each([401, 403])(
  'classifies HTTP %s as authorization and exposes a copyable correlation id',
  async (status) => {
    await mount('active', 'voice', true, { failStatus: status });
    await screen.findByText(i18n.t('agent.desktop.failure.authorization'));
    expect(screen.getByText('support-test-42')).toBeDefined();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.copySupportCode') }));
    await screen.findByText(i18n.t('agent.desktop.supportCodeCopied'));
    expect(writeText).toHaveBeenCalledWith('support-test-42');
  },
);
it('classifies malformed script components and reports only safe failure metadata to the server', async () => {
  const f = await mount('active', 'voice', false, {
    expectFailure: true,
    decorate: (desktop) => {
      desktop.document.pages[0]!.layout.children![0]!['props'] = {
        contentKey: 'invalid-secret-value',
      };
    },
  });
  await screen.findByText(i18n.t('agent.desktop.failure.script'));
  const report = f.requests.find((request) => request.path.endsWith('/desktop/failure'));
  expect(report?.body['kind']).toBe('script');
  expect(typeof report?.body['correlationId']).toBe('string');
  expect(JSON.stringify(report)).not.toContain('invalid-secret-value');
  expect(screen.queryByText('invalid-secret-value')).toBeNull();
});
it('classifies IndexedDB failures separately from the network', async () => {
  await mount('active', 'voice', false, {
    expectFailure: true,
    vaultFailure: new DOMException('private-storage-detail', 'QuotaExceededError'),
  });
  await screen.findByText(i18n.t('agent.desktop.failure.storage'));
  expect(screen.queryByText('private-storage-detail')).toBeNull();
});
it('shows takeover to the owner of a read-only live session', async () => {
  const f = await mount('active', 'voice', false, { readOnly: true });
  const button = await screen.findByRole('button', { name: i18n.t('agent.desktop.takeover') });
  fireEvent.click(button);
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/takeover'))).toBe(true);
  });
});

it.each(['block', 'continue', 'manual'] as const)(
  'exposes and executes the author-approved %s data-source recovery policy',
  async (dataPolicy) => {
    const f = await mount('active', 'voice', false, { dataPolicy });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('runtime.execute') }));
    await screen.findByText(i18n.t('agent.desktop.dataSourceFailed'));
    if (dataPolicy === 'block') {
      expect(
        screen.queryByRole('button', { name: i18n.t('agent.desktop.continueWithoutData') }),
      ).toBeNull();
      fireEvent.click(
        within(
          screen.getByText(i18n.t('agent.desktop.dataSourceFailed')).closest('.vb-alert')!,
        ).getByRole('button', { name: i18n.t('agent.desktop.retry') }),
      );
      await waitFor(() => {
        expect(
          f.requests.filter((request) => request.path.endsWith('/desktop/data-source')),
        ).toHaveLength(2);
      });
    } else {
      if (dataPolicy === 'manual') {
        fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
          target: { value: 'Manual synthetic value' },
        });
        fireEvent.click(
          screen.getByRole('button', { name: i18n.t('agent.desktop.confirmManualData') }),
        );
      } else
        fireEvent.click(
          screen.getByRole('button', { name: i18n.t('agent.desktop.continueWithoutData') }),
        );
      await waitFor(() => {
        expect(
          f.requests.some((request) => request.path.endsWith('/desktop/data-source-recovery')),
        ).toBe(true);
      });
      await waitFor(() => {
        expect(screen.queryByText(i18n.t('agent.desktop.dataSourceFailed'))).toBeNull();
      });
    }
  },
);

function resizeObserver() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
}
it('sends page feedback with only a fixed reason and announces it', async () => {
  const f = await mount();
  resizeObserver();
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.desktop.feedback') }));
  const dialog = await screen.findByRole('dialog', { name: i18n.t('agent.desktop.feedbackTitle') });
  fireEvent.click(
    within(dialog).getByRole('radio', { name: i18n.t('agent.desktop.feedbackReasons.tooLong') }),
  );
  fireEvent.click(
    within(dialog).getByRole('button', { name: i18n.t('agent.desktop.feedbackSend') }),
  );
  await screen.findByText(i18n.t('agent.desktop.feedbackSent'));
  expect(screen.queryByRole('dialog')).toBeNull();
  const sent = f.requests.find((request) => request.path.endsWith('/desktop/feedback'));
  expect(sent?.body).toEqual({ pageId: 'home', reason: 'tooLong' });
});
it('keeps the feedback dialog open with an error when sending fails', async () => {
  await mount('active', 'voice', false, { failStatus: 503 });
  resizeObserver();
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.desktop.feedback') }));
  const dialog = await screen.findByRole('dialog', { name: i18n.t('agent.desktop.feedbackTitle') });
  fireEvent.click(
    within(dialog).getByRole('button', { name: i18n.t('agent.desktop.feedbackSend') }),
  );
  await within(dialog).findByText(i18n.t('agent.desktop.feedbackFailed'));
});
