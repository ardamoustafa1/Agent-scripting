import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pageTitle } from '@verbis/components';
import { Alert, Button } from '@verbis/ui';

import { type Prompt, type TranscriptLine } from './api.js';
import { type AgentController } from './controller.js';
import { useArticleTitle, type DesktopKnowledge } from './knowledge.js';

/** Prompt cards shown at once; older pending ones follow when these are resolved. */
export const VISIBLE_PROMPTS = 3;

const toneOf = (prompt: Prompt) => {
  const alert = prompt.actions.find((action) => action.type === 'alert');
  return alert?.type === 'alert' ? alert.tone : 'info';
};

/**
 * Transcript trigger prompts (ADR-0052): what the customer just said and what the script suggests.
 * Nothing happens without the agent: "Go to page" navigates through the runtime's own guards and
 * "Open the article" shows it in the side panel (ADR-0057). Notice hints are shown in the
 * compliance list, not here.
 */
export function LivePrompts({
  controller: c,
  knowledge,
  onOpenArticle,
  prompts,
  lines,
  disabled,
  run,
}: {
  controller: AgentController;
  knowledge: DesktopKnowledge;
  onOpenArticle: (key: string) => void;
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
        const suggested = prompt.actions.find((action) => action.type === 'suggestArticle');
        // A card that offers something is declined with "Not now"; a hint is acknowledged.
        const offer = pageName !== null || suggested !== undefined;
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
            {suggested?.type === 'suggestArticle' && (
              <ArticleSuggestion
                sessionId={c.id}
                knowledge={knowledge}
                articleKey={suggested.articleKey}
                disabled={disabled}
                onOpen={() => {
                  onOpenArticle(suggested.articleKey);
                  // A page suggestion on the same card stays for the agent to decide.
                  if (pageName === null) void run(() => c.resolvePrompt(prompt, 'accepted'));
                }}
              />
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
                variant={offer ? 'ghost' : 'secondary'}
                disabled={disabled}
                onClick={() =>
                  void run(() => c.resolvePrompt(prompt, offer ? 'dismissed' : 'accepted'))
                }
              >
                {t(offer ? 'agent.desktop.prompts.dismiss' : 'agent.desktop.prompts.ok')}
              </Button>
            </div>
          </Alert>
        );
      })}
    </section>
  );
}

/** The suggested article's title and an "Open the article" button; a missing one says so. */
function ArticleSuggestion({
  sessionId,
  knowledge,
  articleKey,
  disabled,
  onOpen,
}: {
  sessionId: string;
  knowledge: DesktopKnowledge;
  articleKey: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { title, missing } = useArticleTitle(sessionId, knowledge, articleKey);
  if (missing) return <p>{t('agent.desktop.prompts.articleMissing')}</p>;
  if (title === null) return null;
  return (
    <div className="ag-prompt-actions">
      <p>{t('agent.desktop.prompts.suggestArticle', { title })}</p>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={onOpen}>
        {t('agent.desktop.prompts.openArticle')}
      </Button>
    </div>
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
