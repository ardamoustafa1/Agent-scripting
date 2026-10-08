/**
 * Session path replay (ADR-0050, metadata-only option; DIFFERENTIATORS B2). Reconstructs how a
 * real session moved through its pinned script from the events the runtime already keeps. Event
 * payloads are redacted per variable classification when written; this module only ever copies
 * values the runtime itself stored, and nothing at all from event types it does not know.
 */
export interface ReplayEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly occurredAt: Date;
}
export interface ReplayPage {
  readonly id: string;
  readonly name: string;
}

export type ReplayStep =
  | { seq: number; atMs: number; kind: 'page'; pageId: string; pageName: string | null }
  | { seq: number; atMs: number; kind: 'field'; variable: string; value: string }
  | { seq: number; atMs: number; kind: 'state'; from: string; to: string }
  | { seq: number; atMs: number; kind: 'timer'; timerId: string }
  | { seq: number; atMs: number; kind: 'other'; type: string };

export interface ReplayPageSummary {
  pageId: string;
  name: string;
  visits: number;
  dwellMs: number;
}
export interface Replay {
  durationMs: number;
  steps: ReplayStep[];
  pages: ReplayPageSummary[];
  /** Pages of the pinned version this session never reached. */
  unreached: ReplayPage[];
  /** True when the event list hit the cap and the tail is missing. */
  truncated: boolean;
}

const MAX_VALUE_LENGTH = 200;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Only strings the runtime stored are shown; anything structured collapses to a marker. */
function displayValue(value: unknown): string {
  if (typeof value === 'string')
    return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return '[…]';
}

export function buildReplay(
  events: readonly ReplayEvent[],
  pages: readonly ReplayPage[],
  cap: number,
): Replay {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const truncated = ordered.length > cap;
  const used = truncated ? ordered.slice(0, cap) : ordered;
  const start = used[0]?.occurredAt.getTime() ?? 0;
  const names = new Map(pages.map((page) => [page.id, page.name]));
  const steps: ReplayStep[] = [];
  const summary = new Map<string, ReplayPageSummary>();
  let current: { pageId: string; since: number } | null = null;
  const leave = (at: number) => {
    if (!current) return;
    const entry = summary.get(current.pageId);
    if (entry) entry.dwellMs += Math.max(0, at - current.since);
    current = null;
  };
  for (const event of used) {
    const atMs = Math.max(0, event.occurredAt.getTime() - start);
    const payload = record(event.payload);
    if (event.type === 'page.entered') {
      const pageId = text(payload['pageId']);
      if (pageId === undefined) continue;
      leave(atMs);
      const entry = summary.get(pageId) ?? {
        pageId,
        name: names.get(pageId) ?? pageId,
        visits: 0,
        dwellMs: 0,
      };
      entry.visits += 1;
      summary.set(pageId, entry);
      current = { pageId, since: atMs };
      steps.push({
        seq: event.seq,
        atMs,
        kind: 'page',
        pageId,
        pageName: names.get(pageId) ?? null,
      });
    } else if (event.type === 'field.changed') {
      const variable = text(payload['variable']);
      if (variable !== undefined)
        steps.push({
          seq: event.seq,
          atMs,
          kind: 'field',
          variable,
          value: displayValue(payload['value']),
        });
    } else if (event.type === 'session.transitioned') {
      const from = text(payload['from']),
        to = text(payload['to']);
      if (from !== undefined && to !== undefined) {
        if (to !== 'active' && to !== 'wrapup') leave(atMs);
        steps.push({ seq: event.seq, atMs, kind: 'state', from, to });
      }
    } else if (event.type === 'timer.started') {
      const timerId = text(payload['timerId']);
      if (timerId !== undefined) steps.push({ seq: event.seq, atMs, kind: 'timer', timerId });
    } else {
      steps.push({ seq: event.seq, atMs, kind: 'other', type: event.type });
    }
  }
  const durationMs = Math.max(0, (used.at(-1)?.occurredAt.getTime() ?? start) - start);
  leave(durationMs);
  const reached = new Set(summary.keys());
  return {
    durationMs,
    steps,
    pages: [...summary.values()],
    unreached: pages.filter((page) => !reached.has(page.id)),
    truncated,
  };
}
