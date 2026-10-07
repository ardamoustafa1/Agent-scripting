import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  suggestOperations,
  TooManyOperationsError,
  type JsonPatchOperation,
  type ScriptDocument,
} from '@verbis/script-schema';
import { SuggestionSchema } from '@verbis/shared-types';
import { Alert, Button, Dialog, Input, Textarea } from '@verbis/ui';

import { ApiError, request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

import type { EditorStore } from './store.js';

/**
 * Suggestion mode (ADR-0051, DIFFERENTIATORS C2). While it is on the draft is never saved: the
 * editor works on a local copy and "Propose" sends the difference as a suggestion the owner can
 * accept or reject. Leaving the mode restores the saved draft.
 */
export function SuggestMode({
  scriptId,
  number,
  store,
  suggesting,
  canEnter,
  onSuggestingChange,
  onRestored,
}: {
  scriptId: string;
  number: number;
  store: EditorStore;
  suggesting: boolean;
  /** False while there are unsaved edits: the base of a suggestion must be the saved draft. */
  canEnter: boolean;
  onSuggestingChange: (suggesting: boolean) => void;
  /** Called after the saved draft was put back, so the editor treats it as saved. */
  onRestored: () => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace();
  const [base, setBase] = useState<ScriptDocument | null>(null);
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState<'' | 'invalid' | 'tooMany' | 'failed'>(''),
    [sent, setSent] = useState(false),
    [prepared, setPrepared] = useState<{ list: JsonPatchOperation[]; error: '' | 'tooMany' }>({
      list: [],
      error: '',
    });

  const operations = (): { list: JsonPatchOperation[]; error: '' | 'tooMany' } => {
    const before = base;
    if (!before) return { list: [], error: '' };
    try {
      const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
      return {
        list: suggestOperations(plain(before), plain(store.getSnapshot().document)),
        error: '',
      };
    } catch (error) {
      if (error instanceof TooManyOperationsError) return { list: [], error: 'tooMany' };
      throw error;
    }
  };
  const restore = () => {
    if (base) store.applyRemote(base);
    onRestored();
    onSuggestingChange(false);
    setBase(null);
  };

  if (!suggesting)
    return (
      <>
        <Button
          className="ed-command"
          size="sm"
          variant="ghost"
          aria-label={t('designer.suggest.toggle')}
          title={canEnter ? t('designer.suggest.toggle') : t('designer.suggest.saveFirst')}
          disabled={!canEnter}
          onClick={() => {
            setBase(store.getSnapshot().document);
            setSent(false);
            onSuggestingChange(true);
          }}
        >
          <MessageSquarePlus size={17} aria-hidden />
        </Button>
        {sent && <span role="status">{t('designer.suggest.sent')}</span>}
      </>
    );

  return (
    <>
      <span role="status" className="ed-suggest-banner">
        {t('designer.suggest.active')}
      </span>
      <Button
        size="sm"
        onClick={() => {
          setProblem('');
          setPrepared(operations());
          setOpen(true);
        }}
      >
        {t('designer.suggest.propose')}
      </Button>
      <Button size="sm" variant="ghost" onClick={restore}>
        {t('designer.suggest.discard')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('designer.suggest.dialogTitle')}
        description={t('designer.suggest.dialogHelp')}
      >
        <Input
          label={t('designer.suggest.titleLabel')}
          value={title}
          maxLength={120}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <Textarea
          label={t('designer.suggest.noteLabel')}
          value={note}
          maxLength={1000}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <p>{t('designer.suggest.changes', { count: prepared.list.length })}</p>
        {(problem || prepared.error) && (
          <Alert
            tone="danger"
            title={t(`designer.suggest.problem.${problem || prepared.error || 'failed'}`)}
          />
        )}
        <Button
          loading={busy}
          disabled={busy || !title.trim() || prepared.list.length === 0}
          onClick={() => {
            setBusy(true);
            setProblem('');
            void request(
              `/v1/scripts/${scriptId}/versions/${number}/suggestions`,
              SuggestionSchema,
              {
                method: 'POST',
                csrf: session.csrfToken,
                body: {
                  title: title.trim(),
                  ...(note.trim() ? { note: note.trim() } : {}),
                  operations: prepared.list,
                },
              },
            )
              .then(() => {
                setOpen(false);
                setTitle('');
                setNote('');
                restore();
                setSent(true);
              })
              .catch((error: unknown) => {
                setProblem(
                  error instanceof ApiError && error.status === 422 ? 'invalid' : 'failed',
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {t('designer.suggest.send')}
        </Button>
      </Dialog>
    </>
  );
}
