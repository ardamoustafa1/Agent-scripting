import ExcelJS from 'exceljs';

import type { AnalyticsDashboard } from '@verbis/shared-types';

export function csvCell(value: unknown): string {
  if (
    value !== null &&
    value !== undefined &&
    !['string', 'number', 'boolean'].includes(typeof value)
  )
    throw new Error('Only scalar analytics cells may be exported');
  let text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportRows(d: AnalyticsDashboard) {
  return [
    ['scriptId', 'sessions', 'completed', 'completionRate', 'meanDurationMs'],
    ...d.scripts.map((s) => [s.key, s.sessions, s.completed, s.completionRate, s.meanDurationMs]),
  ];
}
export function csvReport(d: AnalyticsDashboard) {
  const rows: unknown[][] = [['section', 'dimension', 'measure', 'value']];
  for (const [section, items] of Object.entries({
    summary: [
      {
        sessions: d.sessions,
        completed: d.completed,
        completionRate: d.completionRate,
        meanDurationMs: d.meanDurationMs,
      },
    ],
    scripts: d.scripts,
    pages: d.pages,
    paths: d.paths,
    outcomes: d.outcomes,
    sources: d.sources,
    variants: d.variants,
    comparisons: d.comparisons,
    compliance: [d.compliance],
    heatmap: d.heatmap,
    agents: d.agents,
    liveCampaigns: d.liveCampaigns,
  })) {
    for (const item of items) {
      const entries = Object.entries(item),
        dimension = entries
          .filter(([key]) =>
            [
              'key',
              'source',
              'target',
              'experimentId',
              'a',
              'b',
              'pageId',
              'nodeId',
              'versionId',
            ].includes(key),
          )
          .map(([, value]) => value)
          .join(' / ');
      for (const [key, value] of entries)
        if (
          ![
            'key',
            'source',
            'target',
            'experimentId',
            'a',
            'b',
            'pageId',
            'nodeId',
            'versionId',
          ].includes(key)
        )
          rows.push([section, dimension, key, value]);
    }
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export async function xlsxReport(d: AnalyticsDashboard) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Verbis';
  book.addWorksheet('Scripts').addRows(reportRows(d));
  for (const [name, rows] of Object.entries({
    Summary: [
      {
        sessions: d.sessions,
        completed: d.completed,
        completionRate: d.completionRate,
        meanDurationMs: d.meanDurationMs,
      },
    ],
    Pages: d.pages,
    Paths: d.paths,
    Outcomes: d.outcomes,
    Sources: d.sources,
    Variants: d.variants,
    Comparisons: d.comparisons,
    Compliance: [d.compliance],
    Heatmap: d.heatmap,
    Agents: d.agents,
    LiveCampaigns: d.liveCampaigns,
  })) {
    const s = book.addWorksheet(name),
      first = rows[0];
    if (first) {
      const keys = Object.keys(first);
      s.addRow(keys);
      for (const row of rows) s.addRow(Object.values(row));
    }
  }
  for (const s of book.worksheets) {
    s.getRow(1).font = { bold: true };
    s.views = [{ state: 'frozen', ySplit: 1 }];
    (s.columns as ExcelJS.Column[] | null)?.forEach((c) => {
      c.width = 24;
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
