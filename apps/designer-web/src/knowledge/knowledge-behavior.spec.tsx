import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { keyFromTitle, parseTags, previewKnowledge } from './api.js';
import KnowledgeEditorPage from './editor.js';
import KnowledgeList from './list.js';
import { ArticlePicker } from './picker.js';

const ID = '0199a000-0000-7000-8000-0000000000cc';
const article = (over: Record<string, unknown> = {}) => ({
  id: ID,
  key: 'refund-policy',
  title: 'Refund policy',
  body: 'Refunds are made within 14 days.',
  tags: ['refund'],
  locale: 'en',
  status: 'draft',
  publishedAt: null,
  createdAt: '2026-10-22T10:00:00.000Z',
  createdBy: 'user:u-1',
  updatedAt: '2026-10-22T10:00:00.000Z',
  updatedBy: 'user:u-1',
  version: 1,
  ...over,
});
const hit = (over: Record<string, unknown> = {}) => ({
  key: 'refund-policy',
  title: 'Refund policy',
  snippet: 'Refunds are made within 14 days.',
  tags: [],
  locale: 'en',
  status: 'published',
  updatedAt: '2026-10-22T10:00:00.000Z',
  ...over,
});

describe('knowledge helpers (ADR-0057)', () => {
  it('proposes a kebab-case key from a Turkish title', () => {
    expect(keyFromTitle('İade Politikası — Kredi Kartı')).toBe('iade-politikasi-kredi-karti');
    expect(keyFromTitle('2026 kampanyası')).toBe('article-2026-kampanyasi');
    expect(keyFromTitle('?!')).toBe('');
    expect(keyFromTitle('kelime '.repeat(30)).length).toBeLessThanOrEqual(64);
  });

  it('reads comma- or line-separated tags without repeats', () => {
    expect(parseTags('iade, kart,\n iade ,, ')).toEqual(['iade', 'kart']);
  });

  it('previews only what agents would see: published articles', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
            '/by-key/',
          )
            ? Response.json(article())
            : Response.json({ results: [hit(), hit({ key: 'draft-one', status: 'draft' })] }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await previewKnowledge.article('refund-policy', signal)).toBeNull();
    expect((await previewKnowledge.search('refund', signal)).map((h) => h.key)).toEqual([
      'refund-policy',
    ]);
  });
});

describe('knowledge pages', () => {
  it('lists articles with their state and offers a new one to authors', async () => {
    const f = await mountDesigner(<KnowledgeList />, {
      '/v1/knowledge-articles?limit=50': {
        data: [article({ status: 'published' })],
        page: { nextCursor: null },
      },
    });
    await screen.findByRole('table');
    const toggle = screen.queryByRole('button', { name: /show all rows/i });
    if (toggle) fireEvent.click(toggle);
    expect(await screen.findByRole('link', { name: 'Refund policy' })).toHaveProperty(
      'pathname',
      `/knowledge/${ID}`,
    );
    screen.getByText(f.label('knowledge.statuses.published'));
    screen.getByRole('link', { name: f.label('knowledge.create') });
  });

  it('creates a draft with a key taken from the title', async () => {
    const f = await mountDesigner(
      <KnowledgeEditorPage />,
      { 'POST /v1/knowledge-articles': article() },
      { route: '/knowledge/:id', path: '/knowledge/new' },
    );
    fireEvent.change(screen.getByRole('textbox', { name: f.label('knowledge.articleTitle') }), {
      target: { value: 'Refund Policy' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^Tags/ }), {
      target: { value: 'refund, card' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^Article text/ }), {
      target: { value: '## Steps\n- Record the request' },
    });
    expect(screen.getByRole('heading', { level: 4, name: 'Steps' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: f.label('knowledge.save') }));
    await waitFor(() => {
      expect(f.requests.find((r) => r.method === 'POST')?.body).toEqual({
        key: 'refund-policy',
        title: 'Refund Policy',
        body: '## Steps\n- Record the request',
        tags: ['refund', 'card'],
        locale: 'tr',
      });
    });
  });

  it('edits with If-Match, keeps the key fixed and publishes only saved text', async () => {
    const f = await mountDesigner(
      <KnowledgeEditorPage />,
      {
        [`/v1/knowledge-articles/${ID}`]: article(),
        [`PATCH /v1/knowledge-articles/${ID}`]: article({ title: 'Refunds', version: 2 }),
        [`POST /v1/knowledge-articles/${ID}/publish`]: article({ status: 'published', version: 2 }),
      },
      { route: '/knowledge/:id', path: `/knowledge/${ID}` },
    );
    const key = await screen.findByRole('textbox', { name: /^Key/ });
    expect(key.hasAttribute('readonly')).toBe(true);
    const publish = screen.getByRole('button', { name: f.label('knowledge.publish') });
    fireEvent.change(screen.getByRole('textbox', { name: f.label('knowledge.articleTitle') }), {
      target: { value: 'Refunds' },
    });
    expect(publish.hasAttribute('disabled')).toBe(true);
    screen.getByText(f.label('knowledge.saveFirst'));
    fireEvent.click(screen.getByRole('button', { name: f.label('knowledge.save') }));
    await waitFor(() => {
      expect(f.requests.find((r) => r.method === 'PATCH')).toBeDefined();
    });
    const patch = f.requests.find((r) => r.method === 'PATCH');
    expect(new Headers(patch?.init?.headers).get('if-match')).toBe('"1"');
    expect(patch?.body).toMatchObject({ title: 'Refunds' });
    expect(patch?.body).not.toHaveProperty('key');
  });

  it('publishes a saved draft and shows a conflict when someone else changed it', async () => {
    const f = await mountDesigner(
      <KnowledgeEditorPage />,
      {
        [`/v1/knowledge-articles/${ID}`]: article(),
        [`POST /v1/knowledge-articles/${ID}/publish`]: Response.json(
          { code: 'VERBIS_PRECONDITION_FAILED' },
          { status: 412 },
        ),
      },
      { route: '/knowledge/:id', path: `/knowledge/${ID}` },
    );
    fireEvent.click(await screen.findByRole('button', { name: f.label('knowledge.publish') }));
    expect(await screen.findByText(f.label('knowledge.errors.conflict'))).toBeDefined();
    expect(
      new Headers(f.requests.find((r) => r.path.endsWith('/publish'))?.init?.headers).get(
        'if-match',
      ),
    ).toBe('"1"');
  });

  it('hides publishing from authors who may only edit', async () => {
    const f = await mountDesigner(
      <KnowledgeEditorPage />,
      { [`/v1/knowledge-articles/${ID}`]: article() },
      {
        route: '/knowledge/:id',
        path: `/knowledge/${ID}`,
        ability: createAbility([
          { action: ['read', 'create', 'update'], subject: 'KnowledgeArticle' },
        ]),
      },
    );
    await screen.findByRole('button', { name: f.label('knowledge.save') });
    expect(screen.queryByRole('button', { name: f.label('knowledge.publish') })).toBeNull();
  });
});

describe('ArticlePicker', () => {
  it('adds a found article, marks unknown keys and removes chosen ones', async () => {
    const changes: string[][] = [];
    const Harness = () => {
      const [keys, setKeys] = useState(['gone']);
      return (
        <ArticlePicker
          label="Articles"
          value={keys}
          max={10}
          onChange={(next) => {
            changes.push(next);
            setKeys(next);
          }}
        />
      );
    };
    const f = await mountDesigner(<Harness />, {
      '/v1/knowledge-articles/by-key/gone': Response.json(
        { code: 'VERBIS_RESOURCE_NOT_FOUND' },
        { status: 404 },
      ),
      '/v1/knowledge-articles/by-key/refund-policy': article(),
      '/v1/knowledge-articles/search?q=refund&limit=10': { results: [hit()] },
    });
    expect(await screen.findByText(f.label('knowledge.picker.missing'))).toBeDefined();
    fireEvent.change(screen.getByRole('searchbox', { name: f.label('knowledge.picker.search') }), {
      target: { value: 'refund' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add “Refund policy”' }));
    expect(changes.at(-1)).toEqual(['gone', 'refund-policy']);
    expect(await screen.findByText(f.label('knowledge.picker.notPublished'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove “gone”' }));
    expect(changes.at(-1)).toEqual(['refund-policy']);
  });
});
