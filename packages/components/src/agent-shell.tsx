import { useTranslation } from 'react-i18next';

import type { Runtime } from '@verbis/core-runtime';
import { walkNodes, type Node, type ScriptDocument } from '@verbis/script-schema';
import { Progress } from '@verbis/ui';

import type { ReactNode, Ref } from 'react';

/**
 * The frame the agent desktop puts around a script: where the agent is (DIFFERENTIATORS D2),
 * how far the call has come and the live compliance checklist (D3). The agent desktop and the
 * designer preview render the same pieces, so authors see the screen agents work with.
 */
export interface Step {
  id: string;
  title: string;
}

/** Customer-facing page title (its title key), falling back to the designer's page name. */
export function pageTitle(
  document: ScriptDocument,
  pageId: string,
  message: (key: string) => string,
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) return pageId;
  return page.titleKey ? message(page.titleKey) : page.name;
}

/** The pages already completed, most recent last, without the current one. Bounded for display. */
export function stepTrail(
  document: ScriptDocument,
  history: readonly string[],
  current: string | null,
  message: (key: string) => string,
  limit = 12,
): Step[] {
  return history
    .filter((id) => id !== current)
    .slice(-limit)
    .map((id) => ({ id, title: pageTitle(document, id, message) }));
}

/** What the checklist needs from the runtime store. */
export interface ChecklistStore {
  get(path: string): unknown;
  variable(key: string): unknown;
}
export interface ChecklistItem {
  readonly id: string;
  readonly pageId: string;
  /** Customer-facing page title, so the agent knows where the notice is. */
  readonly page: string;
  readonly label: string;
  readonly done: boolean;
}

/**
 * Live compliance checklist (DIFFERENTIATORS D3). It lists every `mustRead` notice of the script
 * in page order and mirrors the SAME state the runtime guard uses (`runtime.read.<id>`, the
 * `acknowledged` prop, or a bound variable), so the panel can never say "done" while the
 * server-side guard still blocks the outcome. It adds no schema and no new state.
 */
export function complianceChecklist(
  document: ScriptDocument,
  store: ChecklistStore,
  message: (key: string) => string,
  shown: (node: Node) => boolean = () => true,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  walkNodes(document, ({ node, pageId }) => {
    // A notice hidden on this call (the return terms when no return was asked for) is not owed;
    // the runtime guard skips hidden fields the same way.
    if (node.props['mustRead'] !== true || !shown(node)) return true;
    const binding = node.bindings.find((b) => b.prop === 'acknowledged' && 'variable' in b),
      key = node.props['titleKey'] ?? node.props['labelKey'];
    items.push({
      id: node.id,
      pageId,
      page: pageTitle(document, pageId, message),
      label: typeof key === 'string' && key !== '' ? message(key) : node.id,
      done:
        store.get(`runtime.read.${node.id}`) === true ||
        node.props['acknowledged'] === true ||
        (binding !== undefined &&
          'variable' in binding &&
          store.variable(binding.variable) === true),
    });
    return true;
  });
  return items;
}

export function pendingCount(items: readonly ChecklistItem[]): number {
  return items.filter((item) => !item.done).length;
}

/** Whether a notice is shown on this call; a condition that cannot be evaluated keeps it listed. */
export function noticeShown(runtime: Runtime): (node: Node) => boolean {
  return (node) => {
    try {
      return runtime.condition(node.visibleWhen);
    } catch {
      return true;
    }
  };
}

/** Store paths the checklist reads, so a view can subscribe to exactly those. */
export function checklistPaths(document: ScriptDocument, runtime?: Runtime): string[] {
  const paths: string[] = [];
  walkNodes(document, ({ node }) => {
    if (node.props['mustRead'] !== true) return true;
    paths.push(`runtime.read.${node.id}`);
    if (runtime && node.visibleWhen)
      paths.push(
        ...runtime.expressions.dependenciesOf(runtime.expressions.source(node.visibleWhen)),
      );
    for (const binding of node.bindings)
      if (binding.prop === 'acknowledged' && 'variable' in binding)
        paths.push(`vars.${binding.variable}`);
    return true;
  });
  return paths;
}

/** "Step N", the page title and the steps already completed. */
export function StepHeader({
  step,
  title,
  trail,
  headingRef,
  actions,
}: {
  step: number;
  title: string;
  trail: readonly Step[];
  headingRef?: Ref<HTMLHeadingElement>;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <header className="ag-step">
      <p className="ag-step-count">{t('agent.desktop.step', { number: step })}</p>
      <div className="ag-step-title">
        <h2 ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        {actions}
      </div>
      {trail.length > 0 && (
        <details className="ag-trail">
          <summary>{t('agent.desktop.trail', { count: trail.length })}</summary>
          <ol>
            {trail.map((item, index) => (
              <li key={`${item.id}-${String(index)}`}>{item.title}</li>
            ))}
          </ol>
        </details>
      )}
    </header>
  );
}

/** "Page 3 of 8" with a bar; the position of the current page in the script's page order. */
export function PageProgress({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div className="ag-progress">
      <span>{t('agent.desktop.progress', { current, total })}</span>
      <Progress
        value={Math.max(0, total > 0 ? (current / total) * 100 : 0)}
        label={t('agent.desktop.progressLabel')}
      />
    </div>
  );
}

/** The compliance checklist: status is text and an icon, never colour alone. */
export function ComplianceList({
  items,
  probablySaid = [],
}: {
  items: readonly ChecklistItem[];
  probablySaid?: readonly string[];
}) {
  const { t } = useTranslation();
  const pending = pendingCount(items);
  return (
    <section aria-label={t('agent.desktop.compliance')}>
      <p>{t('agent.desktop.complianceHint')}</p>
      <p role="status">
        {t('agent.desktop.complianceProgress', {
          done: items.length - pending,
          total: items.length,
        })}
      </p>
      <ul className="ag-checklist">
        {items.map((item) => (
          <li key={item.id} data-done={item.done}>
            <span aria-hidden="true">{item.done ? '✓' : '○'}</span>{' '}
            <span>
              {item.label} <small>· {item.page}</small>
            </span>{' '}
            <strong>
              {t(item.done ? 'agent.desktop.complianceDone' : 'agent.desktop.compliancePending')}
            </strong>
            {!item.done && probablySaid.includes(item.id) && (
              <>
                {' '}
                <small>{t('agent.desktop.probablySaid')}</small>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
