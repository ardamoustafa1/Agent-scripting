import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { editorFixture } from '../editor/fixtures.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignFixture, pageFixture, scriptFixture, scriptId } from '../test-fixtures.js';

import AiStudio from './ai.js';

it.each([false, 'unavailable'] as const)(
  'disables generation when AI status is %s',
  async (enabled) => {
    const f = await mountDesigner(<AiStudio />, {
      '/v1/ai/status':
        enabled === false
          ? { enabled }
          : Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
    });
    expect(
      await screen.findByText(f.i18n.t(enabled === false ? 'ai.disabled' : 'ai.error')),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: f.i18n.t('ai.title') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: f.i18n.t('ai.generate') })).toBeNull();
    expect(f.requests).toHaveLength(1);
  },
);
it('creates a reviewed draft from the validated AI document with CSRF and navigates to its script', async () => {
  const document = editorFixture().document;
  const f = await mountDesigner(<AiStudio />, {
    'GET /v1/campaigns?limit=100&sort=name': pageFixture([campaignFixture]),
    '/v1/ai/status': { enabled: true },
    'POST /v1/ai/suggestions': {
      callId: scriptId,
      task: 'draft',
      requiresHumanApproval: true,
      value: document,
      inputTokens: 10,
      outputTokens: 5,
      maskedCount: 1,
    },
    'POST /v1/scripts': scriptFixture,
    [`POST /v1/scripts/${scriptId}/versions`]: {},
  });
  fireEvent.change(await screen.findByLabelText(f.i18n.t('ai.source')), {
    target: { value: 'Create a synthetic script' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('ai.generate') }));
  const accept = await screen.findByRole('button', { name: f.i18n.t('ai.accept') });
  expect(f.requests.some((r) => r.path === '/v1/scripts')).toBe(false);
  expect(accept.hasAttribute('disabled')).toBe(true);
  fireEvent.change(await screen.findByLabelText(f.label('workspace.createCampaign')), {
    target: { value: campaignFixture.id },
  });
  await waitFor(() => {
    expect(accept.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(accept);
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}`);
  });
  expect(f.requests.find((r) => r.path === '/v1/scripts')!.body).toEqual({
    name: document.meta.name,
    tags: document.meta.tags,
    campaignId: campaignFixture.id,
  });
  const save = f.requests.find((r) => r.path.endsWith('/versions'))!;
  expect(save.body).toEqual({ document });
  expect(new Headers(save.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
});
it.each([{ text: 'Synthetic improvement' }, { synthetic: true }])(
  'copies a reviewed improvement without creating a script: %j',
  async (value) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'navigator',
      new Proxy(navigator, {
        get(target, key) {
          return key === 'clipboard' ? { writeText } : (Reflect.get(target, key) as unknown);
        },
      }),
    );
    const f = await mountDesigner(<AiStudio />, {
      '/v1/ai/status': { enabled: true },
      'POST /v1/ai/suggestions': {
        callId: scriptId,
        task: 'improve',
        requiresHumanApproval: true,
        value,
        inputTokens: 1,
        outputTokens: 1,
        maskedCount: 0,
      },
    });
    const task = await screen.findByRole('combobox', { name: f.i18n.t('ai.task') });
    fireEvent.click(task);
    fireEvent.click(await screen.findByRole('option', { name: f.i18n.t('ai.improve') }));
    fireEvent.change(screen.getByLabelText(f.i18n.t('ai.source')), {
      target: { value: 'Improve synthetic script' },
    });
    fireEvent.click(screen.getByRole('button', { name: f.i18n.t('ai.generate') }));
    fireEvent.click(await screen.findByRole('button', { name: f.i18n.t('ai.copySuggestion') }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'text' in value ? value.text : JSON.stringify(value, null, 2),
      );
    });
    expect(f.requests.some((r) => r.path === '/v1/scripts')).toBe(false);
  },
);

it('retries a failed AI version save without creating another script or changing its idempotency key', async () => {
  const document = editorFixture().document;
  const f = await mountDesigner(<AiStudio />, {
    'GET /v1/campaigns?limit=100&sort=name': pageFixture([campaignFixture]),
    '/v1/ai/status': { enabled: true },
    'POST /v1/ai/suggestions': {
      callId: scriptId,
      task: 'draft',
      requiresHumanApproval: true,
      value: document,
      inputTokens: 10,
      outputTokens: 5,
      maskedCount: 0,
    },
    'POST /v1/scripts': scriptFixture,
    [`POST /v1/scripts/${scriptId}/versions`]: Response.json(
      { code: 'VERBIS_HTTP_UNAVAILABLE' },
      { status: 503 },
    ),
  });
  const campaign = await screen.findByLabelText(f.label('workspace.createCampaign'));
  await waitFor(() => {
    expect(campaign.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.change(campaign, {
    target: { value: campaignFixture.id },
  });
  fireEvent.change(screen.getByLabelText(f.i18n.t('ai.source')), {
    target: { value: 'Synthetic retry' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('ai.generate') }));
  const accept = await screen.findByRole('button', { name: f.i18n.t('ai.accept') });
  await waitFor(() => {
    expect(accept.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(accept);
  await screen.findByText(f.i18n.t('ai.error'));
  f.responses[`POST /v1/scripts/${scriptId}/versions`] = {};
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: f.i18n.t('ai.accept') }).hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('ai.accept') }));
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}`);
  });
  expect(f.requests.filter((r) => r.path === '/v1/scripts')).toHaveLength(1);
  const versions = f.requests.filter((r) => r.path.endsWith('/versions'));
  expect(versions).toHaveLength(2);
  const firstKey = new Headers(versions[0]!.init?.headers).get('idempotency-key');
  expect(firstKey).toBeTruthy();
  expect(new Headers(versions[1]!.init?.headers).get('idempotency-key')).toBe(firstKey);
  expect(screen.queryByText(f.i18n.t('ai.error'))).toBeNull();
});

it.each([
  ['en', 'Retry'],
  ['tr', 'Yeniden dene'],
] as const)(
  'offers a translated %s retry after an AI status error and restores generation after recovery',
  async (locale, retryLabel) => {
    const f = await mountDesigner(<AiStudio />, {
      '/v1/ai/status': Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
    });
    await act(async () => {
      await f.i18n.changeLanguage(locale);
    });
    expect(await screen.findByText(f.i18n.t('ai.error'))).toBeTruthy();
    f.responses['/v1/ai/status'] = { enabled: true };
    fireEvent.click(screen.getByRole('button', { name: retryLabel }));
    expect(await screen.findByRole('button', { name: f.i18n.t('ai.generate') })).toBeTruthy();
  },
);
