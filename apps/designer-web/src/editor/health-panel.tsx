import {
  Accessibility,
  ArrowRight,
  CircleCheck,
  Database,
  Gauge,
  Languages,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ScriptDocument } from '@verbis/script-schema';
import { Button, Sheet } from '@verbis/ui';

import { previewLint } from '../preview/lint.js';

import { DataMapView } from './data-map-view.js';
import {
  hygieneIssues,
  issueTarget,
  scriptHealth,
  type HealthCategory,
  type IssueTarget,
  type ScriptHealth,
} from './health.js';

import type { EditorIssue, EditorStore } from './store.js';

const CATEGORY_ICONS: Record<HealthCategory, LucideIcon> = {
  flow: Workflow,
  data: Database,
  privacy: ShieldCheck,
  accessibility: Accessibility,
  language: Languages,
  performance: Gauge,
};

/** Decorative score ring; the number and grade are always given as text too. */
function ScoreRing({ health, size }: { health: ScriptHealth; size: number }) {
  const stroke = size > 40 ? 6 : 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className="ed-health-ring"
      data-grade={health.grade}
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      aria-hidden
    >
      <circle
        className="ed-health-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
      />
      <circle
        className="ed-health-value"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - health.score / 100)}
        transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
      />
    </svg>
  );
}

export function useScriptHealth(
  store: EditorStore,
  document: ScriptDocument,
  fieldProblems: number,
) {
  const base = store.issues();
  return useMemo(() => {
    const issues: EditorIssue[] = [...previewLint(document, base), ...hygieneIssues(document)];
    return { issues, health: scriptHealth(issues, fieldProblems) };
  }, [document, base, fieldProblems]);
}

export function HealthPanel({
  store,
  document,
  fieldProblems,
  onNavigate,
  open: openProp,
  onOpenChange,
}: {
  store: EditorStore;
  document: ScriptDocument;
  fieldProblems: number;
  onNavigate: (target: IssueTarget) => void;
  /** Optional control, e.g. opening the panel from the command palette. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  // Navigate after the sheet has closed so its focus restore cannot pull focus back.
  const pending = useRef<IssueTarget | null>(null);
  const { health } = useScriptHealth(store, document, fieldProblems);
  const grade = t(`designer.health.grades.${health.grade}`);

  const where = (target: IssueTarget | undefined, path: string): string => {
    if (!target) return t('designer.health.locations.document');
    const [, root, index] = path.split('/');
    const variable = root === 'variables' ? document.variables[Number(index)] : undefined;
    if (variable) return t('designer.health.locations.variable', { name: variable.key });
    const rule = root === 'rules' ? document.rules[Number(index)] : undefined;
    if (rule) return t('designer.health.locations.rule', { name: rule.id });
    if (target.mode !== 'screen') return t(`designer.flow.tools.${target.mode}`);
    const page = document.pages.find((p) => p.id === target.pageId);
    const node = target.nodeId ? store.node(target.nodeId) : undefined;
    const pageName = page?.name ?? target.pageId;
    return node && node.id !== page?.layout.id
      ? t('designer.health.locations.node', {
          page: pageName,
          component: t(`designer.editor.componentNames.${node.type}`, { defaultValue: node.type }),
        })
      : t('designer.health.locations.page', { page: pageName });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('designer.health.title')}
      description={t('designer.health.description')}
      className="ed-health-sheet"
      onCloseAutoFocus={(event) => {
        const target = pending.current;
        if (!target) return;
        pending.current = null;
        event.preventDefault();
        onNavigate(target);
      }}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className="ed-health-trigger"
          data-grade={health.grade}
          aria-label={t('designer.health.trigger', { score: health.score, grade })}
        >
          <ScoreRing health={health} size={22} />
          <span className="ed-health-trigger-score" aria-hidden>
            {health.score}
          </span>
          <span className="ed-health-trigger-label" aria-hidden>
            {t('designer.health.short')}
          </span>
        </Button>
      }
    >
      <section className="ed-health-hero" data-grade={health.grade} aria-live="polite">
        <div className="ed-health-hero-ring">
          <ScoreRing health={health} size={88} />
          <span className="ed-health-hero-score">{health.score}</span>
        </div>
        <div>
          <p className="ed-health-grade">{grade}</p>
          <p className="ed-health-summary">
            {health.errors + health.warnings === 0
              ? t('designer.health.clean')
              : t('designer.health.summary', { errors: health.errors, warnings: health.warnings })}
          </p>
        </div>
      </section>
      <ul className="ed-health-categories">
        {health.categories.map(({ category, issues }) => {
          const Icon = CATEGORY_ICONS[category];
          const headingId = `ed-health-${category}`;
          return (
            <li key={category} className="ed-health-category" data-empty={issues.length === 0}>
              <h3 id={headingId} className="ed-health-category-title">
                <Icon size={16} aria-hidden />
                <span>{t(`designer.health.categories.${category}`)}</span>
                <span className="ed-health-count">
                  {issues.length === 0 ? (
                    <>
                      <CircleCheck size={14} aria-hidden />
                      {t('designer.health.noIssues')}
                    </>
                  ) : (
                    t('designer.health.count', { count: issues.length })
                  )}
                </span>
              </h3>
              {issues.length > 0 && (
                <ul aria-labelledby={headingId} className="ed-health-issues">
                  {issues.map((issue, index) => {
                    const target = issueTarget(document, issue.path);
                    return (
                      <li
                        key={`${issue.code}-${issue.path}-${String(index)}`}
                        data-severity={issue.severity}
                      >
                        <span className="ed-health-severity">
                          {t(`designer.health.severity.${issue.severity}`, {
                            defaultValue: issue.severity,
                          })}
                        </span>
                        <span className="ed-health-message">
                          {t(issue.messageKey, issue.params ?? {})}
                          <span className="ed-health-where">{where(target, issue.path)}</span>
                        </span>
                        {target && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ed-health-go"
                            endIcon={<ArrowRight size={14} aria-hidden />}
                            aria-label={t('designer.health.goTo', {
                              place: where(target, issue.path),
                            })}
                            onClick={() => {
                              pending.current = target;
                              setOpen(false);
                            }}
                          >
                            {t('designer.health.go')}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <section className="ed-health-data" aria-labelledby="ed-health-data-title">
        <h3 id="ed-health-data-title">{t('designer.dataMap.title')}</h3>
        <p className="ed-health-summary">{t('designer.dataMap.help')}</p>
        <DataMapView document={document} />
      </section>
    </Sheet>
  );
}
