import { unusedVariables, walkNodes, type ScriptDocument } from '@verbis/script-schema';

import type { EditorIssue } from './store.js';

/**
 * Script Health (DIFFERENTIATORS A4): one 0-100 score over every editor finding, grouped
 * into categories a designer can act on. Pure and deterministic so it can run on every edit.
 */
export const HEALTH_CATEGORIES = [
  'flow',
  'data',
  'privacy',
  'accessibility',
  'language',
  'performance',
] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];
export type HealthGrade = 'excellent' | 'good' | 'fair' | 'poor';

export interface HealthCategoryResult {
  readonly category: HealthCategory;
  readonly penalty: number;
  readonly issues: readonly EditorIssue[];
}
export interface ScriptHealth {
  readonly score: number;
  readonly grade: HealthGrade;
  readonly errors: number;
  readonly warnings: number;
  readonly categories: readonly HealthCategoryResult[];
}

const WEIGHT: Record<string, number> = { error: 12, warning: 4, info: 1 };
/** Privacy and compliance findings carry legal risk, so they weigh double. */
const CATEGORY_WEIGHT: Partial<Record<HealthCategory, number>> = { privacy: 2 };
/** One category can never take more than this, so a single noisy rule cannot zero the score. */
const CATEGORY_CAP = 35;
/** Any blocking error keeps the script out of the passing grades. */
const ERROR_CEILING = 59;

const PRIVACY = new Set([
  'SENSITIVE_DATA_EXPOSED',
  'VARIABLE_PCI_PERSISTED',
  'VARIABLE_CLASSIFICATION_MISMATCH',
  'CONSENT_PRESELECTED',
  'SCENARIO_SENSITIVE',
  'VERBIS_LINT_LEGAL',
  'VERBIS_LINT_LEGAL_PRECHECKED',
  'VERBIS_LINT_UNUSED_SENSITIVE',
]);
const PERFORMANCE = new Set([
  'VERBIS_LINT_DEBOUNCE',
  'DOCUMENT_TOO_LARGE',
  'NODE_DEPTH_EXCEEDED',
  'NODE_COUNT_EXCEEDED',
]);

export function categoryOf(code: string): HealthCategory {
  if (PRIVACY.has(code)) return 'privacy';
  if (PERFORMANCE.has(code)) return 'performance';
  if (code === 'VERBIS_LINT_LABEL') return 'accessibility';
  if (code === 'VERBIS_LINT_COMPLETION_BYPASS') return 'flow';
  if (code.startsWith('I18N_')) return 'language';
  if (
    code.startsWith('FLOW_') ||
    code.startsWith('SUBFLOW_') ||
    code.startsWith('PAGE_') ||
    code.startsWith('TIMER_') ||
    code === 'RULE_REF_BROKEN' ||
    code === 'NODE_REF_BROKEN'
  )
    return 'flow';
  return 'data';
}

/** Editor issues plus document-wide hygiene checks that do not block saving. */
export function hygieneIssues(document: ScriptDocument): EditorIssue[] {
  return unusedVariables(document).map(({ key, path, sensitive }) => ({
    severity: sensitive ? 'warning' : 'info',
    code: sensitive ? 'VERBIS_LINT_UNUSED_SENSITIVE' : 'VERBIS_LINT_UNUSED_VARIABLE',
    path,
    messageKey: sensitive
      ? 'designer.health.issues.unusedSensitive'
      : 'designer.health.issues.unusedVariable',
    params: { variable: key },
  }));
}

export function scriptHealth(issues: readonly EditorIssue[], fieldProblems = 0): ScriptHealth {
  const grouped = new Map<HealthCategory, EditorIssue[]>(HEALTH_CATEGORIES.map((c) => [c, []]));
  for (const issue of issues) grouped.get(categoryOf(issue.code))?.push(issue);
  const categories = HEALTH_CATEGORIES.map((category) => {
    const list = grouped.get(category) ?? [];
    // Repeats of one rule count with diminishing weight (1, 1/2, 1/3 …): fifty missing
    // translations are one problem to fix, not fifty.
    const seen = new Map<string, number>();
    let penalty = category === 'data' ? fieldProblems * (WEIGHT['error'] ?? 0) : 0;
    for (const issue of list) {
      const n = (seen.get(issue.code) ?? 0) + 1;
      seen.set(issue.code, n);
      penalty += ((WEIGHT[issue.severity] ?? 1) * (CATEGORY_WEIGHT[category] ?? 1)) / n;
    }
    return { category, penalty: Math.min(CATEGORY_CAP, penalty), issues: list };
  });
  const errors = issues.filter((i) => i.severity === 'error').length + fieldProblems;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  let score = Math.max(0, Math.round(100 - categories.reduce((sum, c) => sum + c.penalty, 0)));
  if (errors > 0) score = Math.min(score, ERROR_CEILING);
  const grade: HealthGrade =
    score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'fair' : 'poor';
  return { score, grade, errors, warnings, categories };
}

export type IssueTarget =
  { mode: 'screen'; pageId: string; nodeId?: string } | { mode: 'flow' | 'rules' | 'variables' };

/** Where in the editor an issue's JSON Pointer lives, so the panel can take the designer there. */
export function issueTarget(document: ScriptDocument, path: string): IssueTarget | undefined {
  const segments = path.split('/').slice(1);
  const [root, index] = segments;
  if (root === 'flow' || root === 'subflows') return { mode: 'flow' };
  if (root === 'rules') return { mode: 'rules' };
  if (root === 'variables') return { mode: 'variables' };
  if (root !== 'pages') return undefined;
  const page = document.pages[Number(index)];
  if (!page) return undefined;
  if (segments[2] !== 'layout') return { mode: 'screen', pageId: page.id };
  // The deepest node whose pointer prefixes the issue path (same pointers the lint emits).
  let nodeId = page.layout.id;
  let depth = -1;
  walkNodes(document, ({ node, pointer, pageId, depth: level }) => {
    if (
      pageId === page.id &&
      level > depth &&
      (path === pointer || path.startsWith(`${pointer}/`))
    ) {
      nodeId = node.id;
      depth = level;
    }
    return true;
  });
  return { mode: 'screen', pageId: page.id, nodeId };
}
