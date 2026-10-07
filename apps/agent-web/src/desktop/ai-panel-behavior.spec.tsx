import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import { AgentAiPanel } from './ai-panel.js';
import { Desktop, type View } from './api.js';
import { AgentController } from './controller.js';

import type { DraftVault } from './vault.js';

const socket = vi.hoisted(() => ({ handlers: new Map<string, () => void>() }));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, callback: () => void) => {
      socket.handlers.set(event, callback);
    },
    disconnect: vi.fn(),
  }),
}));
const id = '01928f3a-0000-7000-8000-000000000001';
let i18n: I18nInstance;
const controllers: AgentController[] = [],
  clients: QueryClient[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  socket.handlers.clear();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(
  channel = 'chat',
  state: View['state'] = 'active',
  value: unknown = { reply: 'Synthetic approved reply' },
  enabled = true,
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
      configurable: true,
      value: key === 'hasPointerCapture' ? () => false : vi.fn(),
    });
  const desktop = Desktop.parse({
    view: {
      id,
      state,
      sequence: 1,
      readOnly: false,
      snapshot: { variables: {}, currentPage: 'home', history: [], timers: {} },
    },
    document: minimalScript(),
    checksum: 'synthetic',
    startedAt: '2026-10-03T10:00:00Z',
    interaction: {
      channel,
      status: 'connected',
      queue: null,
      platform: 'simulator',
      customerName: null,
      context: {},
    },
    campaign: { name: 'Synthetic', outcomes: [] },
    writeback: 'none',
  });
  const fetcher = vi.fn<typeof fetch>().mockImplementation((url, options) => {
    const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (path.endsWith('/ai/status'))
      return Promise.resolve(Response.json({ agentEnabled: enabled }));
    if (path.endsWith('/ai/suggestions')) {
      const body = JSON.parse(typeof options?.body === 'string' ? options.body : '{}') as {
        task: string;
      };
      return Promise.resolve(
        Response.json({
          callId: id,
          task: body.task,
          requiresHumanApproval: true,
          value,
          inputTokens: 10,
          outputTokens: 5,
          maskedCount: 1,
        }),
      );
    }
    if (path.endsWith('/attach'))
      return Promise.resolve(
        Response.json({
          ...desktop.view,
          writeToken: 'synthetic-writer',
          leaseUntil: '2026-10-03T12:00:00Z',
        }),
      );
    if (path.endsWith('/socket-ticket'))
      return Promise.resolve(Response.json({ ticket: 'synthetic' }));
    return Promise.resolve(Response.json({ ...desktop, view: desktop.view }));
  });
  vi.stubGlobal('fetch', fetcher);
  const vault = {
    partition: 'synthetic',
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as DraftVault;
  const controller = new AgentController(id, desktop, 'synthetic-csrf', vault, 'en');
  controllers.push(controller);
  await controller.initialize();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const ui = render(
    <QueryClientProvider client={client}>
      <UiProvider i18n={i18n}>
        <AgentAiPanel controller={controller} csrf="synthetic-csrf" />
      </UiProvider>
    </QueryClientProvider>,
  );
  return { controller, fetcher, ui, save: vault.save.bind(vault) };
}
async function generate(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('ai.generate') }));
  return screen.findByRole('button', { name: i18n.t(label) });
}
it.each(['voice', 'chat'])(
  'keeps AI hidden for %s when channel or tenant configuration denies it',
  async (channel) => {
    const f = await mount(channel, 'active', {}, channel === 'voice');
    await waitFor(() => {
      expect(
        f.fetcher.mock.calls.some(([url]) => typeof url === 'string' && url.endsWith('/ai/status')),
      ).toBe(true);
    });
    expect(f.ui.container.textContent).toBe('');
  },
);
it.each([{ reply: 'Synthetic approved reply' }, {}])(
  'copies only a human-reviewed reply with session binding and CSRF',
  async (value) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const f = await mount('chat', 'active', value);
    const accept = await generate('ai.copy');
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(accept);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('reply' in value ? value.reply : '');
    });
    const call = f.fetcher.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/ai/suggestions'),
    );
    expect(call?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'synthetic-csrf' });
    expect(JSON.parse(typeof call?.[1]?.body === 'string' ? call[1].body : '{}')).toMatchObject({
      task: 'reply',
      sessionId: id,
    });
  },
);
it.each([{ summary: 'Reviewed summary', disposition: 'DONE' }, {}])(
  'applies reviewed wrap-up summaries through the durable preference store',
  async (value) => {
    const f = await mount('voice', 'wrapup', value);
    const accept = await generate('ai.apply');
    expect(f.controller.getSnapshot().note).toBe('');
    fireEvent.click(accept);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: i18n.t('ai.saved') })).toBeDefined();
    });
    expect(f.controller.getSnapshot()).toMatchObject({
      note: 'summary' in value ? value.summary : '',
      disposition: 'disposition' in value ? value.disposition : '',
    });
    expect(f.controller.getSnapshot().draftSaving).toBe(false);
  },
);
it('focuses a reviewed objection handler inside the bound session without touching another interaction', async () => {
  const f = await mount('email', 'active', { objectionNodeId: 'synthetic-node' });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const root = document.createElement('section');
  root.dataset['agentSession'] = id;
  const node = document.createElement('div');
  node.dataset['runtimeNode'] = 'synthetic-node';
  const target = document.createElement('button');
  node.append(target);
  root.append(node);
  f.ui.container.append(root);
  fireEvent.click(await screen.findByRole('combobox', { name: i18n.t('ai.task') }));
  fireEvent.click(await screen.findByRole('option', { name: i18n.t('ai.objection') }));
  fireEvent.click(await generate('ai.focus'));
  await waitFor(() => {
    expect(document.activeElement).toBe(target);
  });
  expect(target.tabIndex).toBe(-1);
});
it('handles an objection with no handler and disables generation when the session goes offline', async () => {
  const f = await mount('chat', 'active', {});
  fireEvent.click(await screen.findByRole('combobox', { name: i18n.t('ai.task') }));
  fireEvent.click(await screen.findByRole('option', { name: i18n.t('ai.objection') }));
  fireEvent.click(await generate('ai.focus'));
  await screen.findByRole('button', { name: i18n.t('ai.saved') });
  act(() => {
    socket.handlers.get('disconnect')?.();
  });
  expect(
    screen.getByRole('button', { name: i18n.t('ai.generate') }).getAttribute('disabled'),
  ).not.toBeNull();
  expect(f.controller.getSnapshot().online).toBe(false);
});
it('shows summaries for completed email sessions while retaining read-only review restrictions', async () => {
  await mount('email', 'completed');
  const generateButton = await screen.findByRole('button', { name: i18n.t('ai.generate') });
  expect(generateButton.getAttribute('disabled')).not.toBeNull();
  expect(screen.getByRole('combobox', { name: i18n.t('ai.task') }).textContent).toContain(
    i18n.t('ai.summary'),
  );
});

it('moves to a suggested page only after the operator approves it, through the runtime', async () => {
  const f = await mount('chat', 'active', { pageId: 'second-page' });
  const navigate = vi.spyOn(f.controller.runtime, 'navigate').mockResolvedValue(undefined);
  fireEvent.click(await screen.findByRole('combobox', { name: i18n.t('ai.task') }));
  fireEvent.click(await screen.findByRole('option', { name: i18n.t('ai.navigate') }));
  const approve = await generate('ai.goto');
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(approve);
  await waitFor(() => {
    expect(navigate).toHaveBeenCalledWith('second-page');
  });
});
it('does nothing when no page is suggested', async () => {
  const f = await mount('chat', 'active', { pageId: null });
  const navigate = vi.spyOn(f.controller.runtime, 'navigate').mockResolvedValue(undefined);
  fireEvent.click(await screen.findByRole('combobox', { name: i18n.t('ai.task') }));
  fireEvent.click(await screen.findByRole('option', { name: i18n.t('ai.navigate') }));
  fireEvent.click(await generate('ai.goto'));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: i18n.t('ai.saved') })).toBeTruthy();
  });
  expect(navigate).not.toHaveBeenCalled();
});
