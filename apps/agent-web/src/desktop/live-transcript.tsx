import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pageTitle } from '@verbis/components';
import { Alert, Button } from '@verbis/ui';

import { type Prompt, type TranscriptLine } from './api.js';
import { type AgentController } from './controller.js';

/** Prompt cards shown at once; older pending ones follow when these are resolved. */
export const VISIBLE_PROMPTS = 3;

const toneOf = (prompt: Prompt) => {
  const alert = prompt.actions.find((action) => action.type === 'alert');
  return alert?.type === 'alert' ? alert.tone : 'info';
};

/**
 * Transcript trigger prompts (ADR-0052): what the customer just said and what the script suggests.
 * Nothing happens without the agent: "Go to page" navigates through the runtime's own guards.
 * Notice hints are shown in the compliance list, not here.
 */
export function LivePrompts({
  controller: c,
  prompts,
  lines,
  disabled,
  run,
}: {
  controller: AgentController;
  prompts: readonly Prompt[];
  lines: readonly TranscriptLine[];
  disabled: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const visible = prompts
    .filter((prompt) => prompt.actions.some((action) => action.type !== 'markNotice'))
    .slice(0, VISIBLE_PROMPTS);
  if (visible.length === 0) return null;
  const message = (key: string) => c.runtime.message(key);
  return (
    <section className="ag-prompts" aria-label={t('agent.desktop.prompts.region')}>
      {visible.map((prompt) => {
        const said = lines.find((line) => line.segmentId === prompt.segmentId);
        const page = prompt.actions.find((action) => action.type === 'suggestPage');
        const pageName =
          page?.type === 'suggestPage' ? pageTitle(c.runtime.document, page.pageId, message) : null;
        return (
          <Alert
            key={prompt.triggerId}
            tone={toneOf(prompt)}
            title={t(`agent.desktop.prompts.heard.${prompt.speaker}`)}
          >
            {said && <q className="ag-prompt-quote">{said.text}</q>}
            {prompt.actions.map((action, index) =>
              action.type === 'alert' ? <p key={index}>{message(action.messageKey)}</p> : null,
            )}
            {pageName !== null && (
              <p>{t('agent.desktop.prompts.suggestPage', { page: pageName })}</p>
            )}
            <div className="ag-prompt-actions">
              {pageName !== null && (
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => void run(() => c.resolvePrompt(prompt, 'accepted'))}
                >
                  {t('agent.desktop.prompts.go', { page: pageName })}
                </Button>
              )}
              <Button
                size="sm"
                variant={pageName === null ? 'secondary' : 'ghost'}
                disabled={disabled}
                onClick={() =>
                  void run(() =>
                    c.resolvePrompt(prompt, pageName === null ? 'accepted' : 'dismissed'),
                  )
                }
              >
                {t(
                  pageName === null ? 'agent.desktop.prompts.ok' : 'agent.desktop.prompts.dismiss',
                )}
              </Button>
            </div>
          </Alert>
        );
      })}
    </section>
  );
}

/**
 * The call's live transcript, oldest first. A log the agent reads at will: it is not announced
 * line by line (that would talk over the customer); prompts are announced instead.
 */
export function LiveTranscript({ lines }: { lines: readonly TranscriptLine[] }) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    const element = scroller.current;
    if (follow && element) element.scrollTop = element.scrollHeight;
  }, [lines, follow]);
  if (lines.length === 0) return <p className="ag-muted">{t('agent.desktop.liveEmpty')}</p>;
  // The log role sits on the scroll box so the list keeps its list semantics.
  return (
    <div
      ref={scroller}
      className="ag-live-transcript"
      role="log"
      aria-live="off"
      aria-label={t('agent.desktop.liveTranscript')}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard access to a scrollable log (WCAG 2.1.1)
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
      }}
    >
      <ol>
        {lines.map((line) => (
          <li key={line.segmentId} data-speaker={line.speaker} data-final={line.final}>
            <span className="ag-live-speaker">{t(`agent.desktop.speaker.${line.speaker}`)}</span>
            <span>
              {line.text}
              {!line.final && <span className="vb-sr-only">{t('agent.desktop.interim')}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
