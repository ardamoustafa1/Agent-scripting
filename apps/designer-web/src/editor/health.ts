import { unusedVariables, walkNodes, type ScriptDocument } from '@verbis/script-schema';

import { variableName } from '../flow/model.js';

import { messageTokens, nodeTexts, parseParamsExpression } from './text-variables.js';

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
    code.startsWith('TRIGGER_') ||
    code === 'RULE_REF_BROKEN' ||
    code === 'NODE_REF_BROKEN'
  )
    return 'flow';
  return 'data';
}

/**
 * `{name}` placeholders in a component's texts that nothing fills: the agent would read
 * "[name]". Custom params expressions cannot be checked statically and are skipped.
 */
export function placeholderIssues(document: ScriptDocument): EditorIssue[] {
  const variables = new Set(document.variables.map((v) => v.key));
  const issues: EditorIssue[] = [];
  walkNodes(document, ({ node, pointer }) => {
    const tokens = messageTokens(...nodeTexts(document, node));
    if (!tokens.length) return true;
    const provided = new Set<string>();
    const statics = node.props['params'];
    if (statics !== null && typeof statics === 'object' && !Array.isArray(statics))
      for (const key of Object.keys(statics)) provided.add(key);
    const binding = node.bindings.find((b) => b.prop === 'params');
    if (binding) {
      const pairs = 'expression' in binding ? parseParamsExpression(binding.expression) : null;
      if (!pairs) return true;
      for (const key of pairs.keys()) provided.add(key);
    }
    for (const name of tokens)
      if (!provided.has(name))
        issues.push({
          severity: 'warning',
          code: 'VERBIS_LINT_PLACEHOLDER',
          path: pointer,
          messageKey: variables.has(name)
            ? 'designer.health.issues.placeholderUnbound'
            : 'designer.health.issues.placeholderUnknown',
          params: { name },
        });
    return true;
  });
  return issues;
}

/** Pages after which the call can enter another page: by the flow, a subflow or a navigate action. */
function pagesThatLeadOn(document: ScriptDocument): Set<string> {
  const leading = new Set<string>();
  for (const flow of [document.flow, ...document.subflows]) {
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    for (const origin of flow.nodes) {
      if (origin.type !== 'page') continue;
      const seen = new Set([origin.id]);
      const queue = flow.edges.filter((e) => e.from === origin.id).map((e) => e.to);
      while (queue.length) {
        const id = queue.shift() ?? '';
        if (seen.has(id)) continue;
        seen.add(id);
        const node = byId.get(id);
        // The end of a subflow returns to its caller, which usually goes on to more pages.
        if (
          !node ||
          node.type === 'page' ||
          node.type === 'subflow' ||
          (node.type === 'end' && flow !== document.flow)
        ) {
          leading.add(origin.page);
          break;
        }
        if (node.type === 'end' || node.type === 'transfer') continue;
        queue.push(...flow.edges.filter((e) => e.from === id).map((e) => e.to));
      }
    }
  }
  const navigates = (value: unknown, from: string): boolean =>
    Array.isArray(value)
      ? value.some((item) => navigates(item, from))
      : value !== null && typeof value === 'object'
        ? ((value as Record<string, unknown>)['type'] === 'navigate' &&
            (value as Record<string, unknown>)['page'] !== from) ||
          Object.values(value).some((item) => navigates(item, from))
        : false;
  for (const page of document.pages) if (navigates(page.layout, page.id)) leading.add(page.id);
  return leading;
}
/**
 * Always-required fields that keep their value in a page-scoped variable (ADR-0055). Entering the
 * next page clears the variable, so the call's completing outcome then fails on the empty field
 * and the agent cannot close the call. Pages from which the call can only end are fine.
 */
export function pageScopedRequiredIssues(document: ScriptDocument): EditorIssue[] {
  const scoped = new Map(
    document.variables.flatMap((variable, index) =>
      variable.scope === 'page' ? [[variable.key, index] as const] : [],
    ),
  );
  if (!scoped.size) return [];
  const leading = pagesThatLeadOn(document);
  const messages = document.i18n.messages[document.i18n.defaultLocale] ?? {};
  const issues: EditorIssue[] = [];
  walkNodes(document, ({ node, pageId }) => {
    // A `requiredWhen` condition is the author's own way out (e.g. "until the code is verified",
    // the telecom template's OTP); only a field that is always required is a sure dead end.
    if (node.props['required'] !== true || node.requiredWhen || !leading.has(pageId)) return true;
    const binding = node.bindings.find(
      (b) => (b.prop === 'value' || b.prop === 'checked') && 'variable' in b,
    );
    const key = binding && 'variable' in binding ? binding.variable : undefined;
    const index = key === undefined ? undefined : scoped.get(key);
    if (key === undefined || index === undefined) return true;
    const labelKey = node.props['labelKey'];
    const label = typeof labelKey === 'string' ? (messages[labelKey]?.trim() ?? '') : '';
    issues.push({
      severity: 'error',
      code: 'VERBIS_LINT_PAGE_SCOPED_REQUIRED',
      path: `/variables/${String(index)}`,
      messageKey: 'designer.health.issues.pageScopedRequired',
      params: {
        field: label === '' ? variableName(document, key) : label,
        page: document.pages.find((p) => p.id === pageId)?.name ?? pageId,
        variable: variableName(document, key),
        key,
      },
    });
    return true;
  });
  return issues;
}

/** Editor issues plus document-wide hygiene checks that do not block saving. */
export function hygieneIssues(document: ScriptDocument): EditorIssue[] {
  return [
    ...unusedVariableIssues(document),
    ...placeholderIssues(document),
    ...pageScopedRequiredIssues(document),
  ];
}
function unusedVariableIssues(document: ScriptDocument): EditorIssue[] {
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
  | { mode: 'screen'; pageId: string; nodeId?: string }
  | { mode: 'flow' | 'rules' | 'triggers' | 'variables' };

/** Where in the editor an issue's JSON Pointer lives, so the panel can take the designer there. */
export function issueTarget(document: ScriptDocument, path: string): IssueTarget | undefined {
  const segments = path.split('/').slice(1);
  const [root, index] = segments;
  if (root === 'flow' || root === 'subflows') return { mode: 'flow' };
  if (root === 'rules') return { mode: 'rules' };
  if (root === 'triggers') return { mode: 'triggers' };
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
