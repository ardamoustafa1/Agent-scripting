import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import {
  EMPTY_KNOWLEDGE,
  KnowledgeTab,
  desktopKnowledge,
  type KnowledgeState,
} from './knowledge.js';

const id = '01928f3a-0000-7000-8000-000000000001';
const refund = {
  key: 'refund-policy',
  title: 'Refund policy',
  body: 'Refunds are made within 14 days.\n\n## Steps\n- Record the request',
  tags: ['refund'],
  locale: 'en',
  updatedAt: '2026-10-22T10:00:00.000Z',
};
let i18n: I18nInstance;
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
  vi.unstubAllGlobals();
});

function serve(answer: unknown = null, agentEnabled = true) {
  const requests: { path: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((url, options) => {
      const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const body: unknown =
        typeof options?.body === 'string' ? JSON.parse(options.body) : undefined;
      requests.push({ path, method: options?.method ?? 'GET', body });
      if (path.endsWith('/v1/ai/status'))
        return Promise.resolve(Response.json({ enabled: agentEnabled, agentEnabled }));
      if (path.endsWith('/desktop/knowledge/search'))
        return Promise.resolve(
          Response.json({
            results: [
              {
                key: 'refund-policy',
                title: 'Refund policy',
                snippet: 'Refunds are made within 14 days.',
                tags: ['refund'],
                locale: 'en',
                status: 'published',
                updatedAt: refund.updatedAt,
              },
            ],
          }),
        );
      if (path.endsWith('/desktop/knowledge/refund-policy'))
        return Promise.resolve(Response.json(refund));
      if (path.endsWith('/v1/ai/suggestions'))
        return Promise.resolve(
          Response.json({
            callId: '01928f3a-0000-7000-8000-0000000000aa',
            task: 'answer',
            requiresHumanApproval: true,
            value: answer,
            inputTokens: 1,
            outputTokens: 1,
            maskedCount: 0,
          }),
        );
      return Promise.resolve(Response.json({ code: 'VERBIS_RESOURCE_NOT_FOUND' }, { status: 404 }));
    }),
  );
  return requests;
}

function mount(options: { lastLine?: string | null; focus?: boolean } = {}) {
  const focused = vi.fn();
  const Harness = () => {
    const [state, setState] = useState<KnowledgeState>(EMPTY_KNOWLEDGE);
    return (
      <KnowledgeTab
        sessionId={id}
        csrf="synthetic-csrf"
        knowledge={desktopKnowledge(id, 'synthetic-csrf')}
        state={state}
        onState={setState}
        focusRequested={options.focus ?? false}
        onFocused={focused}
        lastCustomerLine={options.lastLine ?? null}
        platformItems={<p>platform items</p>}
      />
    );
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UiProvider i18n={i18n}>
        <Harness />
      </UiProvider>
    </QueryClientProvider>,
  );
  return { focused };
}

describe('knowledge tab (ADR-0057)', () => {
  it('searches in a POST body, never in the URL, and reads an article in place', async () => {
    const requests = serve();
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the knowledge base' }), {
      target: { value: 'refund customer Ayşe' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Refund policy/ }));
    const search = requests.find((r) => r.path.endsWith('/desktop/knowledge/search'));
    expect(search).toMatchObject({
      method: 'POST',
      path: `/api/v1/sessions/${id}/desktop/knowledge/search`,
      body: { q: 'refund customer Ayşe', limit: 10 },
    });
    expect(requests.some((r) => r.path.includes('Ay'))).toBe(false);
    expect(await screen.findByRole('heading', { level: 3, name: 'Refund policy' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 4, name: 'Steps' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'refund customer Ayşe');
    screen.getByText('platform items');
  });

  it('starts from the last customer sentence and focuses the box on request', async () => {
    serve();
    const { focused } = mount({ lastLine: 'Kartım çalındı', focus: true });
    await waitFor(() => {
      expect(focused).toHaveBeenCalledOnce();
    });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    fireEvent.click(screen.getByRole('button', { name: "Use the customer's last sentence" }));
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'Kartım çalındı');
  });

  it('asks the AI with the question only and shows the answer with its sources', async () => {
    const requests = serve({
      answer: 'Within 14 days.',
      articleKeys: ['refund-policy'],
      reason: 'x',
    });
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'How long is a refund?' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Answer with AI' }));
    await screen.findByText('Within 14 days.');
    screen.getByText('Check the sources before telling the customer.');
    expect(requests.find((r) => r.path.endsWith('/v1/ai/suggestions'))?.body).toMatchObject({
      task: 'answer',
      text: 'How long is a refund?',
      sessionId: id,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refund policy' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Refund policy' })).toBeDefined();
  });

  it('says when the knowledge base has no answer', async () => {
    serve({ answer: null, articleKeys: [], reason: 'none' });
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Mars delivery?' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Answer with AI' }));
    await screen.findByText('The knowledge base does not answer this question.');
  });

  it('offers no AI answer when agent AI is off', async () => {
    const requests = serve(null, false);
    mount();
    await waitFor(() => {
      expect(requests.some((r) => r.path.endsWith('/v1/ai/status'))).toBe(true);
    });
    expect(screen.queryByRole('button', { name: 'Answer with AI' })).toBeNull();
  });
});
