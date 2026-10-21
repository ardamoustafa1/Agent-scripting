import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ComplianceList,
  PageProgress,
  StepHeader,
  checklistPaths,
  complianceChecklist,
  noticeShown,
  pageTitle,
  pendingCount,
  stepTrail,
} from '@verbis/components';
import { ScriptRenderer, useRuntimePaths, type Runtime } from '@verbis/core-runtime';
import { Button } from '@verbis/ui';

/**
 * The script inside the same frame the agent desktop draws: step and title, the steps already
 * done, page progress with Back/Next, and the live compliance checklist. Built from the shared
 * agent-shell parts, so the designer sees the agent's screen rather than a bare page.
 */
export function AgentFrame({ runtime }: { runtime: Runtime }) {
  const { t } = useTranslation();
  const { document } = runtime;
  useRuntimePaths(runtime, [
    'runtime.page',
    'runtime.ended',
    'runtime.locale',
    ...checklistPaths(document, runtime),
  ]);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const message = (key: string) => runtime.message(key);
  const shown = runtime.store.get('runtime.page');
  const pageId = typeof shown === 'string' ? shown : null;
  const ended = runtime.store.get('runtime.ended') === true;
  const history = runtime.pageHistory();
  const trail = stepTrail(document, history, pageId, message);
  const checklist = complianceChecklist(document, runtime.store, message, noticeShown(runtime)),
    pending = pendingCount(checklist);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await work();
    } catch {
      // The debugger timeline records the cause; the frame only says the step did not happen.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pv-agent">
      <div className="pv-agent-main">
        {pageId !== null && !ended && (
          <StepHeader
            step={trail.length + 1}
            title={pageTitle(document, pageId, message)}
            trail={trail}
          />
        )}
        <div className="pv-agent-runtime">
          <ScriptRenderer runtime={runtime} autoStart={false} />
        </div>
        {failed && <p role="alert">{t('runtime.error')}</p>}
        <footer className="pv-agent-footer">
          <Button
            variant="secondary"
            disabled={busy || ended || history.length === 0}
            onClick={() => void run(() => runtime.back())}
          >
            <ChevronLeft size={16} aria-hidden />
            {t('agent.desktop.back')}
          </Button>
          <PageProgress
            current={document.pages.findIndex((page) => page.id === pageId) + 1}
            total={document.pages.length}
          />
          <Button
            disabled={busy || ended || pageId === null}
            onClick={() =>
              void run(async () => {
                // Same order as the agent desktop: the page must be valid before moving on.
                if (pageId !== null && (await runtime.validation.page(pageId)).length)
                  throw new Error('VERBIS_VALIDATION_FAILED');
                await runtime.next();
              })
            }
          >
            {t('agent.desktop.next')}
            <ChevronRight size={16} aria-hidden />
          </Button>
        </footer>
      </div>
      {checklist.length > 0 && (
        <aside className="pv-agent-side" aria-label={t('agent.desktop.compliance')}>
          <h2>
            {pending > 0
              ? `${t('agent.desktop.compliance')} (${String(pending)})`
              : t('agent.desktop.compliance')}
          </h2>
          <ComplianceList items={checklist} />
        </aside>
      )}
    </div>
  );
}
