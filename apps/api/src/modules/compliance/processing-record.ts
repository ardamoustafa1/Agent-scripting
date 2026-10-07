import {
  dataMap,
  type DataDestination,
  type DataMapEntry,
  type DataOrigin,
  type ScriptDocument,
} from '@verbis/script-schema';

import { csvCell } from '../analytics/export.js';

/**
 * One row per sensitive variable of a published script version: the KVKK art. 16 / GDPR art. 30
 * style record of processing derived from what the script really does (DIFFERENTIATORS G2).
 * Derived from classification tags only: it never contains values, customer data or free text.
 */
export interface ProcessingRow {
  readonly scriptId: string;
  readonly scriptName: string;
  readonly versionNumber: number;
  readonly variable: string;
  readonly classification: DataMapEntry['classification'];
  readonly origins: string;
  readonly destinations: string;
  readonly persisted: boolean;
  /** Card data reaches something other than the secure capture, or personal data reaches log/analytics. */
  readonly attention: boolean;
}

const origin = (o: DataOrigin): string =>
  o.kind === 'context'
    ? `context:${o.path}`
    : o.kind === 'agentInput'
      ? `agentInput:${o.node}`
      : o.kind === 'dataSource'
        ? `dataSource:${o.id}`
        : 'script';
const destination = (d: DataDestination): string =>
  d.kind === 'integration' ? `integration:${d.id}` : `${d.kind}:${d.path}`;

/** Same rule as the designer's data-map view (G3): card data anywhere, personal data to log/analytics. */
export function needsAttention(entry: DataMapEntry): boolean {
  return entry.destinations.some(
    (d) => entry.classification === 'pci' || d.kind === 'log' || d.kind === 'analytics',
  );
}

export function processingRows(
  script: { id: string; name: string; versionNumber: number },
  document: ScriptDocument,
): ProcessingRow[] {
  return dataMap(document).map((entry) => ({
    scriptId: script.id,
    scriptName: script.name,
    versionNumber: script.versionNumber,
    variable: entry.variable,
    classification: entry.classification,
    origins: [...new Set(entry.origins.map(origin))].sort().join('; '),
    destinations: [...new Set(entry.destinations.map(destination))].sort().join('; '),
    persisted: entry.persisted,
    attention: needsAttention(entry),
  }));
}

const HEADER = [
  'scriptId',
  'scriptName',
  'version',
  'variable',
  'classification',
  'origins',
  'destinations',
  'persisted',
  'needsAttention',
] as const;

export function processingCsv(rows: readonly ProcessingRow[]): string {
  const lines = rows.map((r) =>
    [
      r.scriptId,
      r.scriptName,
      r.versionNumber,
      r.variable,
      r.classification,
      r.origins,
      r.destinations,
      r.persisted,
      r.attention,
    ]
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [HEADER.map(csvCell).join(','), ...lines].join('\r\n');
}
