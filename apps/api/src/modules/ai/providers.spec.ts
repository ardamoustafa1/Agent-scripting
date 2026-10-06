import { expect, it, vi } from 'vitest';

import { JsonLlmProvider, type Endpoint } from './providers.js';
import { postJson } from './transport.js';

vi.mock('./transport.js', () => ({ postJson: vi.fn() }));
const provider = new JsonLlmProvider();
const endpoint: Endpoint = {
  id: 'fixture',
  provider: 'anthropic',
  url: 'https://model.example.invalid/v1/messages',
  residency: 'fixture',
  models: ['fixture-model'],
  addresses: ['203.0.113.1'],
};
it('maps Anthropic messages and usage without tools or arbitrary headers', async () => {
  vi.mocked(postJson).mockResolvedValue({
    content: [{ type: 'text', text: '{"text":"Hello","legalChecklist":[]}' }],
    usage: { input_tokens: 12, output_tokens: 8 },
  });
  const result = await provider.complete(
    endpoint,
    'synthetic-key',
    'fixture-model',
    'trusted',
    '{"UNTRUSTED_DATA":"hello"}',
    128,
    new AbortController().signal,
  );
  expect(result.inputTokens).toBe(12);
  expect(result.outputTokens).toBe(8);
  expect(vi.mocked(postJson).mock.calls.at(-1)?.[3]).toEqual({
    'x-api-key': 'synthetic-key',
    'anthropic-version': '2023-06-01',
  });
});
for (const kind of ['azure', 'onprem'] as const)
  it(`maps ${kind} completions and uses server-only authentication`, async () => {
    vi.mocked(postJson).mockResolvedValue({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
    await provider.complete(
      { ...endpoint, provider: kind },
      'synthetic-key',
      'fixture-model',
      'trusted',
      'data',
      128,
      new AbortController().signal,
    );
    const headers = vi.mocked(postJson).mock.calls.at(-1)?.[3];
    expect(headers).toEqual(
      kind === 'azure' ? { 'api-key': 'synthetic-key' } : { authorization: 'Bearer synthetic-key' },
    );
  });
it('rejects missing usage instead of claiming zero cost', async () => {
  vi.mocked(postJson).mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
  await expect(
    provider.complete(
      { ...endpoint, provider: 'onprem' },
      'synthetic',
      'fixture-model',
      'trusted',
      'data',
      128,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});
