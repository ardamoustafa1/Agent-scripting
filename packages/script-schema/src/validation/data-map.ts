import { LITERAL_TEXT_PROPS } from '../components.js';
import { fromPointer } from '../pointer.js';

import { collect } from './collect.js';

import type { ScriptDocument } from '../schema/document.js';
import type { Classification } from '../schema/variable.js';

/** Where a sensitive value comes from. */
export type DataOrigin =
  | { kind: 'context'; path: string }
  | { kind: 'agentInput'; node: string }
  | { kind: 'dataSource'; id: string }
  | { kind: 'script' };

/** Where a sensitive value goes. `integration` is a request to an external service. */
export type DataDestination =
  | { kind: 'screen' | 'toast' | 'platform' | 'analytics' | 'log'; path: string }
  | { kind: 'integration'; id: string; path: string };

export interface DataMapEntry {
  variable: string;
  classification: Extract<Classification, 'pii' | 'pci'>;
  origins: DataOrigin[];
  destinations: DataDestination[];
  /** Stored in session events and snapshots. */
  persisted: boolean;
}

function walk(doc: ScriptDocument, segments: readonly string[]): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = doc;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') break;
    current = (current as Record<string, unknown>)[segment];
    chain.push(current);
  }
  return chain;
}

/** The external service a read at `pointer` is sent to, if it sits in a data source request. */
function integrationOf(doc: ScriptDocument, pointer: string): string | undefined {
  const segments = fromPointer(pointer);
  if (segments[0] === 'dataSources' && segments[2] === 'inputs')
    return doc.dataSources[Number(segments[1])]?.id;
  const chain = walk(doc, segments);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const step = chain[i];
    if (
      segments[i + 1] === 'inputs' &&
      step !== null &&
      typeof step === 'object' &&
      (step as { type?: unknown }).type === 'callDataSource'
    )
      return String((step as { dataSource: unknown }).dataSource);
  }
  return undefined;
}

/**
 * Data map (DIFFERENTIATORS G3): for every PII/PCI variable, where it comes from and every place
 * it is shown, written back, logged, counted or sent to an integration. Pure and deterministic.
 */
export function dataMap(doc: ScriptDocument): DataMapEntry[] {
  const refs = collect(doc, LITERAL_TEXT_PROPS).refs;
  const entries: DataMapEntry[] = [];
  for (const variable of doc.variables) {
    const classification: DataMapEntry['classification'] | undefined =
      variable.classification === 'pci'
        ? 'pci'
        : variable.pii || variable.classification === 'pii'
          ? 'pii'
          : undefined;
    if (!classification) continue;
    const origins: DataOrigin[] = [];
    const destinations: DataDestination[] = [];
    if (variable.source) origins.push({ kind: 'context', path: variable.source });
    for (const source of doc.dataSources)
      if (Object.values(source.outputs).some((output) => output.variable === variable.key))
        origins.push({ kind: 'dataSource', id: source.id });
    const inputs = new Set<string>();
    let scripted = false;
    for (const ref of refs) {
      if (ref.id !== variable.key) continue;
      if (ref.kind === 'variableWrite') {
        const segments = fromPointer(ref.path);
        const bindingAt = segments.lastIndexOf('bindings');
        if (bindingAt > 0) {
          const node = walk(doc, segments.slice(0, bindingAt)).at(-1) as
            { id?: string } | undefined;
          if (node?.id) inputs.add(node.id);
        } else if (!segments.includes('outputs')) scripted = true;
        continue;
      }
      if (ref.kind !== 'variableRead') continue;
      const integration = integrationOf(doc, ref.path);
      if (integration) destinations.push({ kind: 'integration', id: integration, path: ref.path });
      else if (ref.sink === 'display') destinations.push({ kind: 'toast', path: ref.path });
      else if (ref.sink) destinations.push({ kind: ref.sink, path: ref.path });
      else if (ref.path.startsWith('/pages/') && ref.path.includes('/bindings/'))
        destinations.push({ kind: 'screen', path: ref.path });
    }
    for (const node of inputs) origins.push({ kind: 'agentInput', node });
    if (scripted) origins.push({ kind: 'script' });
    entries.push({
      variable: variable.key,
      classification,
      origins,
      destinations,
      persisted: variable.persist,
    });
  }
  return entries;
}

/** Destinations present in `after` but not in `before`, per variable: what a release newly exposes. */
export function newDataFlows(
  before: readonly DataMapEntry[],
  after: readonly DataMapEntry[],
): { variable: string; destination: DataDestination }[] {
  const key = (d: DataDestination) => (d.kind === 'integration' ? `integration:${d.id}` : d.kind);
  const seen = new Map(
    before.map((entry) => [entry.variable, new Set(entry.destinations.map(key))] as const),
  );
  const added: { variable: string; destination: DataDestination }[] = [];
  for (const entry of after) {
    const known = seen.get(entry.variable) ?? new Set<string>();
    const reported = new Set<string>();
    for (const destination of entry.destinations) {
      const k = key(destination);
      if (known.has(k) || reported.has(k)) continue;
      reported.add(k);
      added.push({ variable: entry.variable, destination });
    }
  }
  return added;
}
