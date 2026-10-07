import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AiRequestSchema, type AiRequest, type AiSuggestion } from '@verbis/shared-types';

import { Button } from './button.js';
import { Alert } from './feedback.js';
import { Input, Textarea } from './fields.js';
import { Select } from './select.js';

export function AiAssistant({
  mode,
  generate,
  review,
  onAccept,
  allowedTasks,
}: {
  mode: 'designer' | 'agent';
  allowedTasks?: readonly AiRequest['task'][];
  generate: (input: AiRequest) => Promise<AiSuggestion>;
  review?: boolean;
  onAccept?: (value: unknown, task: AiRequest['task']) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [task, setTask] = useState<AiRequest['task']>(
      allowedTasks?.[0] ?? (mode === 'designer' ? 'draft' : 'reply'),
    ),
    [text, setText] = useState(''),
    [document, setDocument] = useState(''),
    [tone, setTone] = useState<AiRequest['tone']>('neutral'),
    [locale, setLocale] = useState<'tr' | 'en'>(i18n.language === 'en' ? 'en' : 'tr'),
    [file, setFile] = useState<AiRequest['file']>(),
    [result, setResult] = useState<AiSuggestion>(),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [accepted, setAccepted] = useState(false);
  const tasks =
    allowedTasks ??
    (mode === 'designer'
      ? (['draft', 'improve', 'scenarios', 'translate'] as const)
      : (['reply', 'objection', 'summary'] as const));
  async function run() {
    setBusy(true);
    setFailed(false);
    setResult(undefined);
    setAccepted(false);
    try {
      const input = AiRequestSchema.parse({
        requestId: crypto.randomUUID(),
        task,
        text,
        tone,
        locale,
        ...(document ? { document: JSON.parse(document) as unknown } : {}),
        ...(file ? { file } : {}),
      });
      setResult(await generate(input));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={t('ai.title')} style={{ display: 'grid', gap: 'var(--vb-space-3)' }}>
      <h2>{t('ai.title')}</h2>
      <p>{t('ai.review')}</p>
      <p>{t('ai.pii')}</p>
      <Select
        label={t('ai.task')}
        value={task}
        options={tasks.map((value) => ({ value, label: t('ai.' + value) }))}
        onValueChange={(value) => {
          setTask(value as AiRequest['task']);
          setFile(undefined);
          setResult(undefined);
        }}
      />
      <Select
        label={t('ai.locale')}
        value={locale}
        options={['tr', 'en'].map((value) => ({ value, label: t('ai.' + value) }))}
        onValueChange={(value) => {
          setLocale(value as 'tr' | 'en');
        }}
      />
      {mode === 'designer' && (
        <Select
          label={t('ai.tone')}
          value={tone}
          options={['neutral', 'warm', 'formal', 'simple'].map((value) => ({
            value,
            label: t('ai.' + value),
          }))}
          onValueChange={(value) => {
            setTone(value as AiRequest['tone']);
          }}
        />
      )}
      <Textarea
        label={t('ai.source')}
        value={text}
        maxLength={64000}
        onChange={(e) => {
          setText(e.target.value);
          setFile(undefined);
          setResult(undefined);
        }}
      />
      {mode === 'designer' && task === 'draft' && (
        <>
          <Input
            type="file"
            label={t('ai.file')}
            accept=".docx,.pdf"
            onChange={(e) => {
              setResult(undefined);
              setFile(undefined);
              const chosen = e.target.files?.[0];
              if (!chosen) return;
              if (chosen.size > 1500000 || !/\.(docx|pdf)$/i.test(chosen.name)) {
                setFailed(true);
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                setFile({
                  kind: chosen.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
                  base64:
                    (typeof reader.result === 'string' ? reader.result : '').split(',')[1] ?? '',
                });
              };
              reader.onerror = () => {
                setFailed(true);
              };
              reader.readAsDataURL(chosen);
            }}
          />
          <p>{t('ai.limit')}</p>
        </>
      )}
      {mode === 'designer' && task === 'scenarios' && (
        <Textarea
          label={t('ai.document')}
          value={document}
          onChange={(e) => {
            setDocument(e.target.value);
          }}
        />
      )}
      <Button
        loading={busy}
        disabled={
          busy || review === false || (mode === 'designer' && !text.trim() && !file && !document)
        }
        onClick={() => void run()}
      >
        {t('ai.generate')}
      </Button>
      {failed && <Alert tone="danger" title={t('ai.error')} />}
      {result && (
        <>
          <h3>{t('ai.output')}</h3>
          <pre
            aria-label={t('ai.preview')}
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {JSON.stringify(result.value, null, 2)}
          </pre>
          <p>
            {t('ai.usageSummary', {
              tokens: result.inputTokens + result.outputTokens,
              masked: result.maskedCount,
            })}
          </p>
          {onAccept && (
            <Button
              disabled={accepted || busy || review === false}
              onClick={() => {
                setBusy(true);
                void onAccept(result.value, result.task)
                  .then(() => {
                    setAccepted(true);
                  })
                  .catch(() => {
                    setFailed(true);
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {t(
                accepted
                  ? 'ai.saved'
                  : mode === 'designer'
                    ? result.task === 'draft'
                      ? 'ai.accept'
                      : 'ai.copySuggestion'
                    : result.task === 'reply'
                      ? 'ai.copy'
                      : result.task === 'objection'
                        ? 'ai.focus'
                        : result.task === 'navigate'
                          ? 'ai.goto'
                          : 'ai.apply',
              )}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
