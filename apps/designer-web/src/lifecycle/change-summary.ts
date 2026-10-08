import { walkNodes, type ScriptDocument } from '@verbis/script-schema';

import { compareItems } from './diff.js';

/**
 * Deterministic change summary between two versions (DIFFERENTIATORS E2). It reads structure only
 * (counts, ids, names, classifications), never message texts or values, so a draft built from it
 * cannot carry customer-facing copy or personal data into a release note. No model is involved;
 * the output is a draft the designer edits before submitting.
 */
export type SummaryLine =
  | { key: 'pages'; added: string[]; removed: string[]; changed: string[] }
  | { key: 'components'; added: number; removed: number; changed: number }
  | { key: 'variables'; added: string[]; removed: string[] }
  | { key: 'sensitive'; variable: string; from: string; to: string }
  | { key: 'rules'; added: number; removed: number; changed: number }
  | { key: 'dataSources'; added: string[]; removed: string[]; changed: string[] }
  | { key: 'flow'; nodes: number; edges: number }
  | { key: 'messages'; locale: string; count: number }
  | { key: 'scenarios'; added: number; removed: number };

const classOf = (v: ScriptDocument['variables'][number]): string =>
  v.classification === 'pci'
    ? 'pci'
    : v.pii || v.classification === 'pii'
      ? 'pii'
      : v.classification;

export function summarizeChanges(before: ScriptDocument, after: ScriptDocument): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const names = (
    rows: {
      id: string;
      before: { name: string } | undefined;
      after: { name: string } | undefined;
    }[],
  ) => rows.map((row) => row.after?.name ?? row.before?.name ?? row.id);

  const pages = compareItems(before.pages, after.pages, (p) => p.id);
  const pageNames = (change: string) => names(pages.filter((p) => p.change === change)).sort();
  if (pages.some((p) => p.change !== 'unchanged'))
    lines.push({
      key: 'pages',
      added: pageNames('added'),
      removed: pageNames('removed'),
      changed: pageNames('changed'),
    });

  const collect = (doc: ScriptDocument) => {
    const nodes: { id: string; value: unknown }[] = [];
    walkNodes(doc, ({ node }) => {
      const { children: _children, ...rest } = node;
      nodes.push({ id: node.id, value: rest });
      return true;
    });
    return nodes;
  };
  const components = compareItems(collect(before), collect(after), (n) => n.id);
  const count = (change: string) => components.filter((c) => c.change === change).length;
  if (count('added') + count('removed') + count('changed') > 0)
    lines.push({
      key: 'components',
      added: count('added'),
      removed: count('removed'),
      changed: count('changed'),
    });

  const variables = compareItems(before.variables, after.variables, (v) => v.key);
  const added = variables
      .filter((v) => v.change === 'added')
      .map((v) => v.id)
      .sort(),
    removed = variables
      .filter((v) => v.change === 'removed')
      .map((v) => v.id)
      .sort();
  if (added.length + removed.length > 0) lines.push({ key: 'variables', added, removed });
  for (const row of variables)
    if (row.before && row.after && classOf(row.before) !== classOf(row.after))
      lines.push({
        key: 'sensitive',
        variable: row.id,
        from: classOf(row.before),
        to: classOf(row.after),
      });

  const rules = compareItems(before.rules, after.rules, (r) => r.id);
  const ruleCount = (change: string) => rules.filter((r) => r.change === change).length;
  if (ruleCount('added') + ruleCount('removed') + ruleCount('changed') > 0)
    lines.push({
      key: 'rules',
      added: ruleCount('added'),
      removed: ruleCount('removed'),
      changed: ruleCount('changed'),
    });

  const sources = compareItems(before.dataSources, after.dataSources, (d) => d.id);
  const sourceIds = (change: string) =>
    sources
      .filter((s) => s.change === change)
      .map((s) => s.id)
      .sort();
  if (sources.some((s) => s.change !== 'unchanged'))
    lines.push({
      key: 'dataSources',
      added: sourceIds('added'),
      removed: sourceIds('removed'),
      changed: sourceIds('changed'),
    });

  const flows = (doc: ScriptDocument) => [doc.flow, ...doc.subflows];
  const flowChange = (pick: 'nodes' | 'edges') => {
    const rows = compareItems(
      flows(before).flatMap((f) => f[pick].map((item) => ({ ...item, flow: f.id }))),
      flows(after).flatMap((f) => f[pick].map((item) => ({ ...item, flow: f.id }))),
      (item) => `${item.flow}:${item.id}`,
    );
    // Designer coordinates are not behaviour: ignore position-only differences.
    return rows.filter((row) => {
      if (row.change !== 'changed') return row.change !== 'unchanged';
      const strip = (item: object | undefined) => {
        const { position: _p, ...rest } = (item ?? {}) as Record<string, unknown>;
        return JSON.stringify(rest, Object.keys(rest).sort());
      };
      return strip(row.before) !== strip(row.after);
    }).length;
  };
  const nodes = flowChange('nodes'),
    edges = flowChange('edges');
  if (nodes + edges > 0) lines.push({ key: 'flow', nodes, edges });

  for (const locale of Object.keys({ ...before.i18n.messages, ...after.i18n.messages }).sort()) {
    const a = before.i18n.messages[locale] ?? {},
      b = after.i18n.messages[locale] ?? {};
    const changed = compareItems(Object.entries(a), Object.entries(b), ([key]) => key).filter(
      (row) => row.change !== 'unchanged',
    ).length;
    if (changed > 0) lines.push({ key: 'messages', locale, count: changed });
  }

  const scenarios = compareItems(
    before.testScenarios ?? [],
    after.testScenarios ?? [],
    (s) => s.id,
  );
  const sAdded = scenarios.filter((s) => s.change === 'added').length,
    sRemoved = scenarios.filter((s) => s.change === 'removed').length;
  if (sAdded + sRemoved > 0) lines.push({ key: 'scenarios', added: sAdded, removed: sRemoved });
  return lines;
}

/** Plain-text draft for the change-note field. `text` maps a line to a localized sentence. */
export function draftNote(
  lines: readonly SummaryLine[],
  text: (line: SummaryLine) => string,
): string {
  return lines.map((line) => `- ${text(line)}`).join('\n');
}
