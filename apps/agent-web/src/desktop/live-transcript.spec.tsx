import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import { Desktop, type Prompt, type TranscriptLine } from './api.js';
import { AgentController, mergeLine, promptNotices, TRANSCRIPT_LINES } from './controller.js';
import { desktopKnowledge } from './knowledge.js';
import { LivePrompts, LiveTranscript, VISIBLE_PROMPTS } from './live-transcript.js';

import type { DraftVault } from './vault.js';

const socket = vi.hoisted(() => ({ handlers: new Map<string, (payload?: unknown) => void>() }));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, callback: (payload?: unknown) => void) => {
      socket.handlers.set(event, callback);
    },
    disconnect: vi.fn(),
  }),
}));
const id = '01928f3a-0000-7000-8000-000000000001';
let i18n: I18nInstance;
const controllers: AgentController[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
});
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
  socket.handlers.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const line = (segmentId: string, text: string, final = true): TranscriptLine => ({
  segmentId,
  speaker: 'customer',
  text,
  final,
  at: '2026-10-22T10:00:00.000Z',
});
const suggest: Prompt = {
  triggerId: 'cancel-intent',
  segmentId: 's1',
  speaker: 'customer',
  firedAt: '2026-10-22T10:00:01.000Z',
  actions: [
    { type: 'suggestPage', pageId: 'retention' },
    { type: 'alert', messageKey: 'hint.cancel', tone: 'warning' },
  ],
};
const hint: Prompt = {
  triggerId: 'price',
  segmentId: 's2',
  speaker: 'agent',
  firedAt: '2026-10-22T10:00:02.000Z',
  actions: [{ type: 'alert', messageKey: 'hint.price', tone: 'info' }],
};
const article: Prompt = {
  triggerId: 'refund-intent',
  segmentId: 's4',
  speaker: 'customer',
  firedAt: '2026-10-22T10:00:04.000Z',
  actions: [{ type: 'suggestArticle', articleKey: 'refund-policy' }],
};
const noticeOnly: Prompt = {
  triggerId: 'recording',
  segmentId: 's3',
  speaker: 'agent',
  firedAt: '2026-10-22T10:00:03.000Z',
  actions: [{ type: 'markNotice', noticeId: 'notice-recording' }],
};

async function mount(prompts: Prompt[], stored: TranscriptLine[] = []) {
  const script = minimalScript();
  script.pages.push({
    id: 'retention',
    name: 'Retention',
    layout: { id: 'retention-root', type: 'box' },
  });
  script.flow.nodes.push({ id: 'n-retention', type: 'page', page: 'retention' });
  script.i18n.messages['en'] = {
    ...script.i18n.messages['en'],
    'hint.cancel': 'Offer the loyalty discount first.',
    'hint.price': 'Mention the price guarantee.',
  };
  const desktop = Desktop.parse({
    view: {
      id,
      state: 'active',
      sequence: 1,
      readOnly: false,
      snapshot: { variables: {}, currentPage: 'home', history: [], timers: {} },
    },
    document: script,
    checksum: 'synthetic',
    startedAt: '2026-10-22T10:00:00Z',
    interaction: {
      channel: 'voice',
      status: 'connected',
      queue: null,
      platform: 'simulator',
      customerName: null,
      context: {},
    },
    campaign: { name: 'Synthetic', outcomes: [] },
    writeback: 'none',
    transcript: { enabled: true },
    prompts,
  });
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let sequence = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((url, options) => {
      const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const body = JSON.parse(typeof options?.body === 'string' ? options.body : '{}') as Record<
        string,
        unknown
      >;
      requests.push({ path, body });
      if (path.endsWith('/attach'))
        return Promise.resolve(
          Response.json({
            ...desktop.view,
            writeToken: 'synthetic-writer',
            leaseUntil: '2099-10-03T12:00:00Z',
          }),
        );
      if (path.endsWith('/socket-ticket'))
        return Promise.resolve(Response.json({ ticket: 'synthetic' }));
      if (path.endsWith('/desktop/transcript'))
        return Promise.resolve(Response.json({ enabled: true, lines: stored }));
      if (path.endsWith('/desktop/knowledge/refund-policy'))
        return Promise.resolve(
          Response.json({
            key: 'refund-policy',
            title: 'Refund policy',
            body: 'Refunds within 14 days.',
            tags: [],
            locale: 'en',
            updatedAt: '2026-10-22T10:00:00.000Z',
          }),
        );
      if (path.includes('/desktop/knowledge/'))
        return Promise.resolve(
          Response.json(
            { code: 'VERBIS_RESOURCE_NOT_FOUND', correlationId: 'synthetic' },
            { status: 404 },
          ),
        );
      if (path.endsWith('/commands') || path.includes('/desktop/prompts/'))
        return Promise.resolve(Response.json({ ...desktop.view, sequence: ++sequence }));
      return Promise.resolve(Response.json(desktop));
    }),
  );
  const vault = {
    partition: 'synthetic',
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as DraftVault;
  const controller = new AgentController(id, desktop, 'synthetic-csrf', vault, 'en');
  controllers.push(controller);
  await controller.initialize();
  await waitFor(() => {
    expect(socket.handlers.has('runtime.transcript')).toBe(true);
  });
  const run = async (work: () => Promise<unknown>) => {
    await work();
  };
  const client = new QueryClient(),
    knowledge = desktopKnowledge(id, 'synthetic-csrf'),
    opened = vi.fn();
  const View = () => {
    const state = controller.getSnapshot();
    return (
      <QueryClientProvider client={client}>
        <UiProvider i18n={i18n}>
          <LivePrompts
            controller={controller}
            knowledge={knowledge}
            onOpenArticle={opened}
            prompts={state.prompts}
            lines={state.transcript}
            disabled={false}
            run={run}
          />
        </UiProvider>
      </QueryClientProvider>
    );
  };
  const ui = render(<View />);
  const rerender = () => {
    ui.rerender(<View />);
  };
  return { controller, requests, rerender, opened };
}

describe('LivePrompts', () => {
  it('offers a suggested article by its title and opens it in the side panel (ADR-0057)', async () => {
    const f = await mount([article]);
    await screen.findByText('Related article: “Refund policy”.');
    fireEvent.click(screen.getByRole('button', { name: 'Open the article' }));
    expect(f.opened).toHaveBeenCalledWith('refund-policy');
    await waitFor(() => {
      expect(f.controller.getSnapshot().prompts).toEqual([]);
    });
    expect(
      f.requests.find((r) => r.path.endsWith('/desktop/prompts/refund-intent'))?.body,
    ).toMatchObject({ resolution: 'accepted' });
    expect(f.requests.some((r) => r.path.endsWith('/commands'))).toBe(false);
  });

  it('keeps a page suggestion open when the article on the same card is read', async () => {
    const both = {
      ...suggest,
      actions: [
        ...suggest.actions,
        { type: 'suggestArticle' as const, articleKey: 'refund-policy' },
      ],
    };
    const f = await mount([both]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the article' }));
    expect(f.opened).toHaveBeenCalledWith('refund-policy');
    expect(f.requests.some((r) => r.path.includes('/desktop/prompts/'))).toBe(false);
    screen.getByRole('button', { name: 'Go to Retention' });
  });

  it('says so when the suggested article is not published, and can be declined', async () => {
    const f = await mount([
      { ...article, actions: [{ type: 'suggestArticle', articleKey: 'withdrawn' }] },
    ]);
    await screen.findByText('The suggested article is not published right now.');
    expect(screen.queryByRole('button', { name: 'Open the article' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(f.controller.getSnapshot().prompts).toEqual([]);
    });
  });

  it('quotes what was said, shows the script hint and offers the suggested step', async () => {
    const f = await mount([suggest]);
    act(() => {
      socket.handlers.get('runtime.transcript')?.(line('s1', 'Aboneliğimi iptal etmek istiyorum'));
    });
    f.rerender();
    screen.getByRole('region', { name: 'Suggestions from the conversation' });
    screen.getByText('The customer said something this script listens for');
    expect(screen.getByText('Aboneliğimi iptal etmek istiyorum').tagName).toBe('Q');
    screen.getByText('Offer the loyalty discount first.');
    screen.getByText('The script suggests the “Retention” step.');
    expect(screen.getByRole('button', { name: 'Go to Retention' }).hasAttribute('disabled')).toBe(
      false,
    );
    screen.getByRole('button', { name: 'Not now' });
  });

  it('accepting navigates through the runtime first, then resolves the prompt', async () => {
    const f = await mount([suggest]);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Retention' }));
    await waitFor(() => {
      expect(f.controller.getSnapshot().prompts).toEqual([]);
    });
    const page = f.requests.findIndex(
      (r) =>
        r.path.endsWith('/commands') &&
        JSON.stringify(r.body['command']).includes('"pageId":"retention"'),
    );
    const resolved = f.requests.findIndex((r) => r.path.endsWith('/desktop/prompts/cancel-intent'));
    expect(page).toBeGreaterThanOrEqual(0);
    expect(resolved).toBeGreaterThan(page);
    expect(f.requests[resolved]?.body).toMatchObject({ resolution: 'accepted' });
    expect(f.controller.runtime.store.get('runtime.page')).toBe('retention');
  });

  it('dismissing never navigates', async () => {
    const f = await mount([suggest]);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(f.controller.getSnapshot().prompts).toEqual([]);
    });
    expect(
      f.requests.find((r) => r.path.endsWith('/desktop/prompts/cancel-intent'))?.body,
    ).toMatchObject({ resolution: 'dismissed' });
    expect(f.requests.some((r) => r.path.endsWith('/commands'))).toBe(false);
  });

  it('an alert-only prompt is acknowledged; notice hints never get a card', async () => {
    const f = await mount([hint, noticeOnly]);
    screen.getByText('You said something this script listens for');
    expect(screen.queryByRole('button', { name: /^Go to/ })).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => {
      expect(f.controller.getSnapshot().prompts.map((p) => p.triggerId)).toEqual(['recording']);
    });
  });

  it(`shows at most ${String(VISIBLE_PROMPTS)} cards`, async () => {
    await mount(Array.from({ length: 5 }, (_, i) => ({ ...hint, triggerId: `hint-${String(i)}` })));
    expect(screen.getAllByRole('button', { name: 'Got it' })).toHaveLength(VISIBLE_PROMPTS);
  });

  it('keeps the notice hint of a resolved prompt', async () => {
    const both: Prompt = { ...hint, actions: [...hint.actions, ...noticeOnly.actions] };
    const f = await mount([both]);
    await act(() => f.controller.resolvePrompt(both, 'accepted'));
    expect(f.controller.getSnapshot().probablySaid).toEqual(['notice-recording']);
  });
});

describe('live transcript in the controller', () => {
  it('merges stored lines after a reconnect with lines that arrived live', async () => {
    const f = await mount([], [line('s1', 'Merhaba'), line('s2', 'Faturam')]);
    act(() => {
      socket.handlers.get('runtime.transcript')?.(line('s3', 'yüksek gel', false));
      socket.handlers.get('runtime.transcript')?.({ segmentId: 'bad' });
    });
    await f.controller.loadTranscript();
    expect(f.controller.getSnapshot().transcript.map((l) => [l.segmentId, l.final])).toEqual([
      ['s1', true],
      ['s2', true],
      ['s3', false],
    ]);
    act(() => {
      socket.handlers.get('runtime.transcript')?.(line('s3', 'yüksek geldi'));
    });
    expect(f.controller.getSnapshot().transcript.at(-1)).toMatchObject({
      text: 'yüksek geldi',
      final: true,
    });
  });

  it('mergeLine replaces interim lines, never downgrades a final one and keeps a window', () => {
    let lines = mergeLine([], line('a', 'iptal', false));
    lines = mergeLine(lines, line('a', 'iptal etmek'));
    expect(lines).toEqual([line('a', 'iptal etmek')]);
    expect(mergeLine(lines, line('a', 'ipt', false))).toBe(lines);
    for (let i = 0; i < TRANSCRIPT_LINES + 5; i += 1)
      lines = mergeLine(lines, line(`n${String(i)}`, 'x'));
    expect(lines).toHaveLength(TRANSCRIPT_LINES);
    expect(lines[0]?.segmentId).toBe('n5');
  });

  it('promptNotices lists the notices pending prompts hint at', () => {
    expect(promptNotices([suggest, noticeOnly])).toEqual(['notice-recording']);
  });
});

describe('LiveTranscript', () => {
  it('is a quiet, keyboard-scrollable log with speaker labels', () => {
    render(
      <UiProvider i18n={i18n}>
        <LiveTranscript
          lines={[
            line('s1', 'İptal etmek istiyorum'),
            { ...line('s2', 'Tabii', false), speaker: 'agent' },
          ]}
        />
      </UiProvider>,
    );
    const log = screen.getByRole('log', { name: 'Live transcript' });
    expect(log.getAttribute('aria-live')).toBe('off');
    expect(log.getAttribute('tabindex')).toBe('0');
    screen.getByText('Customer');
    screen.getByText('You');
    screen.getByText('(still being recognized)');
  });

  it('explains an empty transcript', () => {
    render(
      <UiProvider i18n={i18n}>
        <LiveTranscript lines={[]} />
      </UiProvider>,
    );
    screen.getByText('Nothing has been said yet. Lines appear here as the call goes on.');
  });
});
