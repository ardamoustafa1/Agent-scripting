import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { AiAssistant } from './ai-assistant.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'tr' } }),
}));
it('keeps generation separate from human review and application', async () => {
  const accept = vi.fn().mockResolvedValue(undefined),
    generate = vi.fn().mockResolvedValue({
      callId: '00000000-0000-7000-8000-000000000001',
      task: 'reply',
      requiresHumanApproval: true,
      value: { reply: 'Synthetic reply', reason: 'Fixture' },
      inputTokens: 10,
      outputTokens: 5,
      maskedCount: 1,
    });
  render(<AiAssistant mode="agent" generate={generate} onAccept={accept} />);
  fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'ai.copy' })).toBeDefined();
  });
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'ai.copy' }));
  await waitFor(() => {
    expect(accept).toHaveBeenCalledOnce();
  });
});
it('observer/offline mode disables both generation and applying suggestions', () => {
  render(<AiAssistant mode="agent" generate={vi.fn()} review={false} />);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'ai.generate' }).disabled).toBe(
    true,
  );
});
it.each([
  ['designer', 'draft', 'ai.accept'],
  ['designer', 'improve', 'ai.copySuggestion'],
  ['agent', 'objection', 'ai.focus'],
  ['agent', 'summary', 'ai.apply'],
] as const)(
  'reviews %s %s before application and prevents repeat acceptance',
  async (mode, task, label) => {
    const accept = vi.fn().mockResolvedValue(undefined),
      generate = vi.fn().mockResolvedValue({
        task,
        value: { text: 'safe suggestion' },
        inputTokens: 1,
        outputTokens: 1,
        maskedCount: 0,
        requiresHumanApproval: true,
      });
    render(<AiAssistant mode={mode} allowedTasks={[task]} generate={generate} onAccept={accept} />);
    fireEvent.change(screen.getByLabelText('ai.source'), { target: { value: 'Synthetic input' } });
    fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
    await screen.findByRole('button', { name: label });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ task, text: 'Synthetic input', tone: 'neutral', locale: 'tr' }),
    );
    expect(accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'ai.saved' }).disabled).toBe(
        true,
      );
    });
    expect(accept).toHaveBeenCalledWith({ text: 'safe suggestion' }, task);
  },
);
it('reports generation failure and lets the user try again without stale output', async () => {
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new Error('private upstream failure'))
    .mockResolvedValue({
      task: 'reply',
      value: 'recovered',
      inputTokens: 1,
      outputTokens: 1,
      maskedCount: 0,
    });
  render(<AiAssistant mode="agent" generate={generate} />);
  fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
  await screen.findByText('ai.error');
  expect(screen.queryByText('private upstream failure')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
  await screen.findByLabelText('ai.preview');
  expect(screen.queryByText('ai.error')).toBeNull();
  expect(screen.getByLabelText('ai.preview').textContent).toBe('"recovered"');
});
it('handles acceptance failure without marking a suggestion accepted', async () => {
  const accept = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  render(
    <AiAssistant
      mode="agent"
      generate={vi.fn().mockResolvedValue({
        task: 'reply',
        value: 'safe',
        inputTokens: 1,
        outputTokens: 1,
        maskedCount: 0,
      })}
      onAccept={accept}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
  fireEvent.click(await screen.findByRole('button', { name: 'ai.copy' }));
  await screen.findByText('ai.error');
  expect(screen.queryByText('ai.saved')).toBeNull();
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'ai.copy' }).disabled).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: 'ai.copy' }));
  await screen.findByText('ai.saved');
});
it('validates scenario JSON before sending and preserves its structure', async () => {
  const generate = vi.fn().mockResolvedValue({
    task: 'scenarios',
    value: [],
    inputTokens: 1,
    outputTokens: 1,
    maskedCount: 0,
  });
  render(<AiAssistant mode="designer" allowedTasks={['scenarios']} generate={generate} />);
  fireEvent.change(screen.getByLabelText('ai.document'), { target: { value: '{broken' } });
  fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
  await screen.findByText('ai.error');
  expect(generate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('ai.document'), { target: { value: '{"pages":[]}' } });
  fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ document: { pages: [] }, task: 'scenarios' }),
    );
  });
});
it.each(['.pdf', '.docx'])(
  'uploads a bounded %s file and clears the file when typing a new prompt',
  async (suffix) => {
    const generate = vi.fn().mockResolvedValue({
      task: 'draft',
      value: {},
      inputTokens: 1,
      outputTokens: 1,
      maskedCount: 0,
    });
    render(<AiAssistant mode="designer" generate={generate} />);
    const file = new File(['synthetic'], 'sample' + suffix);
    fireEvent.change(screen.getByLabelText('ai.file'), { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'ai.generate' }).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
    await waitFor(() => {
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ file: { kind: suffix.slice(1), base64: btoa('synthetic') } }),
      );
    });
    fireEvent.change(screen.getByLabelText('ai.source'), { target: { value: 'new prompt' } });
    expect(screen.queryByLabelText('ai.preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ai.generate' }));
    await waitFor(() => {
      expect(generate.mock.calls.at(-1)?.[0]).not.toHaveProperty('file');
    });
  },
);
it.each([new File(['x'], 'malicious.html'), new File([new Uint8Array(1_500_001)], 'oversize.pdf')])(
  'rejects invalid uploads before generation',
  async (file) => {
    const generate = vi.fn();
    render(<AiAssistant mode="designer" generate={generate} />);
    fireEvent.change(screen.getByLabelText('ai.file'), { target: { files: [file] } });
    await screen.findByText('ai.error');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'ai.generate' }).disabled).toBe(
      true,
    );
    expect(generate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('ai.file'), { target: { files: [] } });
  },
);
