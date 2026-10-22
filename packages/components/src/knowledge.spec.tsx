import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { LIBRARY_DEFINITIONS } from './catalog.js';
import { ComponentProvider, type KnowledgePort } from './environment.js';
import {
  KNOWLEDGE_SEARCH_DELAY_MS,
  KnowledgeComponent,
  KnowledgePanelSchema,
} from './knowledge.js';
import { createFixtureRuntime, sampleKnowledge, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
  vi.useRealTimers();
});

function mount(
  props: Record<string, unknown> = {},
  knowledge: KnowledgePort | null = sampleKnowledge,
) {
  const runtime = createFixtureRuntime('knowledgePanel');
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, 'knowledgePanel');
  return render(
    <UiProvider i18n={i18n}>
      <ComponentProvider
        environment={{
          mediaOrigins: [],
          frameOrigins: [],
          knowledgeOrigins: [],
          features: [],
          now: Date.now,
          ...(knowledge ? { knowledge } : {}),
        }}
      >
        <KnowledgeComponent {...component} props={{ ...component.props, ...props }} />
      </ComponentProvider>
    </UiProvider>,
  );
}

describe('knowledgePanel (ADR-0057)', () => {
  it('is a script component whose articles are picked from the knowledge base', () => {
    const definition = LIBRARY_DEFINITIONS.find((entry) => entry.type === 'knowledgePanel');
    expect(definition?.designerMeta.category).toBe('script');
    expect(definition?.designerMeta.properties?.find((p) => p.key === 'articles')).toMatchObject({
      control: 'knowledgeArticles',
      bindable: false,
    });
    expect(KnowledgePanelSchema.safeParse({ articles: ['Not A Key'] }).success).toBe(false);
    expect(
      KnowledgePanelSchema.safeParse({
        articles: Array.from({ length: 11 }, (_, i) => `a${String(i)}`),
      }).success,
    ).toBe(false);
  });

  it('shows pinned articles to read in place and counts the unpublished ones', async () => {
    mount({ articles: ['refund-policy', 'gone'] });
    const trigger = await screen.findByRole('button', { name: 'Refund policy' });
    fireEvent.click(trigger);
    expect(await screen.findByText('Refunds are made within 14 days.')).toBeDefined();
    expect(screen.getByRole('heading', { level: 4, name: 'Steps' })).toBeDefined();
    expect(screen.getByText('1 pinned article(s) are not published right now')).toBeDefined();
  });

  it('says the knowledge base is unavailable when the host has none', () => {
    mount({}, null);
    expect(screen.getByText('The knowledge base is not available here')).toBeDefined();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('searches after typing stops and opens a result without leaving the page', async () => {
    vi.useFakeTimers();
    const search = vi.spyOn(sampleKnowledge, 'search');
    mount({ articles: [] });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the knowledge base' }), {
      target: { value: 'card' },
    });
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KNOWLEDGE_SEARCH_DELAY_MS);
    });
    expect(search).toHaveBeenCalledWith('card', expect.any(AbortSignal));
    vi.useRealTimers();
    fireEvent.click(await screen.findByRole('button', { name: /Lost card/ }));
    expect(await screen.findByRole('heading', { level: 4, name: 'Lost card' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', '1 article(s) found');
  });

  it('keeps Enter in the search box from reaching the desktop shortcuts', async () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    mount({ articles: [] });
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'zzz' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(outside).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outside);
    expect(
      await screen.findByText('No article found', { selector: 'p:not([role])' }),
    ).toBeDefined();
  });

  it('reports a failing knowledge base instead of breaking the page', async () => {
    mount(
      { articles: ['refund-policy'] },
      {
        article: () => Promise.reject(new Error('offline')),
        search: () => Promise.reject(new Error('offline')),
      },
    );
    await waitFor(() => {
      expect(screen.getAllByText('Articles could not be loaded')).toHaveLength(1);
    });
  });

  it('hides the search box when the author pinned articles only', () => {
    mount({ searchable: false });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
