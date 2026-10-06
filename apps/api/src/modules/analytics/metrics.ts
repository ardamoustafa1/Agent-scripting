import type { AnalyticsDashboard, AnalyticsFact } from '@verbis/shared-types';

const terminal = new Set(['completed', 'abandoned', 'expired']);
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
/** Two-sided pooled two-proportion z test. Sparse cells are deliberately inconclusive. */
export function significance(
  a: { sessions: number; completed: number },
  b: { sessions: number; completed: number },
) {
  const difference = b.completed / b.sessions - a.completed / a.sessions;
  if (Math.min(a.completed, b.completed, a.sessions - a.completed, b.sessions - b.completed) < 5)
    return {
      difference: Number.isFinite(difference) ? difference : 0,
      pValue: null,
      significant: false,
      reason: 'insufficient' as const,
    };
  const pooled = (a.completed + b.completed) / (a.sessions + b.sessions),
    se = Math.sqrt(pooled * (1 - pooled) * (1 / a.sessions + 1 / b.sessions)),
    z = Math.abs(difference / se);
  const t = 1 / (1 + 0.2316419 * z),
    density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const pValue = Math.min(
    1,
    2 *
      density *
      (0.31938153 * t -
        0.356563782 * t * t +
        1.781477937 * t ** 3 -
        1.821255978 * t ** 4 +
        1.330274429 * t ** 5),
  );
  return { difference, pValue, significant: pValue < 0.05, reason: 'sufficient' as const };
}
/** Deterministic event-time replay: duplicate delivery and out-of-order arrival cannot change metrics. */
export function aggregate(
  input: readonly AnalyticsFact[],
  agents = false,
  now = new Date(),
): AnalyticsDashboard {
  const events = [...new Map(input.map((f) => [f.eventId, f])).values()].sort(
    (a, b) =>
      a.sessionId.localeCompare(b.sessionId) || a.sequence - b.sequence || a.at.localeCompare(b.at),
  );
  const sessions = new Map<string, AnalyticsFact[]>();
  for (const f of events) {
    const list = sessions.get(f.sessionId) ?? [];
    list.push(f);
    sessions.set(f.sessionId, list);
  }
  const scripts = new Map<string, AnalyticsFact[][]>(),
    agentGroups = new Map<string, AnalyticsFact[][]>(),
    variantGroups = new Map<string, AnalyticsFact[][]>();
  const pages = new Map<
      string,
      { visits: number; sessionIds: Set<string>; dwells: number[]; dropOff: number }
    >(),
    paths = new Map<string, { source: string; target: string; count: number }>(),
    outcomes = new Map<string, number>();
  const sources = new Map<string, { calls: number; durations: number[]; errors: number }>(),
    heat = new Map<
      string,
      {
        versionId: string;
        pageId: string;
        nodeId: string;
        samples: number;
        dwells: number[];
        errors: number;
      }
    >();
  let eligible = 0,
    acknowledged = 0;
  const add = (map: Map<string, AnalyticsFact[][]>, key: string, rows: AnalyticsFact[]) => {
    const old = map.get(key) ?? [];
    old.push(rows);
    map.set(key, old);
  };
  const stats = (key: string, rows: AnalyticsFact[][]) => {
    const completed = rows.filter((r) => r.at(-1)?.state === 'completed').length;
    return {
      key,
      sessions: rows.length,
      completed,
      completionRate: completed / rows.length,
      meanDurationMs: mean(
        rows.flatMap((r) => {
          const first = r.find((f) => f.type === 'start'),
            last = r.at(-1);
          return first && last && terminal.has(last.state)
            ? [Math.max(0, Date.parse(last.at) - Date.parse(first.at))]
            : [];
        }),
      ),
    };
  };
  for (const rows of sessions.values()) {
    const first = rows[0],
      last = rows.at(-1);
    if (!first || !last) continue;
    add(scripts, first.scriptId, rows);
    if (agents) add(agentGroups, first.agent, rows);
    if (first.experimentId && first.variant)
      add(variantGroups, first.experimentId + '|' + first.variant, rows);
    let previous: AnalyticsFact | undefined;
    const required = new Set<string>(),
      read = new Set<string>();
    for (const f of rows) {
      if (f.type === 'page' && f.pageId) {
        for (const id of f.requiredReadIds) required.add(id);
        const key = f.versionId + ':' + f.pageId,
          p = pages.get(key) ?? {
            visits: 0,
            sessionIds: new Set<string>(),
            dwells: [],
            dropOff: 0,
          };
        p.visits++;
        p.sessionIds.add(f.sessionId);
        pages.set(key, p);
        if (previous?.pageId) {
          const prior = pages.get(previous.versionId + ':' + previous.pageId);
          prior?.dwells.push(Math.max(0, Date.parse(f.at) - Date.parse(previous.at)));
          const route = previous.versionId + ':' + previous.pageId + '>' + key,
            edge = paths.get(route) ?? {
              source: previous.versionId + ':' + previous.pageId,
              target: key,
              count: 0,
            };
          edge.count++;
          paths.set(route, edge);
        }
        previous = f;
      }
      if (f.type === 'outcome' && f.outcome)
        outcomes.set(f.outcome, (outcomes.get(f.outcome) ?? 0) + 1);
      if (f.type === 'datasource' && f.sourceId) {
        const s = sources.get(f.sourceId) ?? { calls: 0, durations: [], errors: 0 };
        s.calls++;
        if (f.durationMs !== null) s.durations.push(f.durationMs);
        if (f.error) s.errors++;
        sources.set(f.sourceId, s);
      }
      if ((f.type === 'field' || f.type === 'read') && f.nodeId && f.pageId) {
        const key = f.versionId + ':' + f.pageId + ':' + f.nodeId,
          h = heat.get(key) ?? {
            versionId: f.versionId,
            pageId: f.pageId,
            nodeId: f.nodeId,
            samples: 0,
            dwells: [],
            errors: 0,
          };
        h.samples++;
        if (f.durationMs !== null) h.dwells.push(f.durationMs);
        if (f.error) h.errors++;
        heat.set(key, h);
        if (f.type === 'read') {
          if (!f.error) read.add(f.nodeId);
          else read.delete(f.nodeId);
        }
      }
    }
    if (previous?.pageId && terminal.has(last.state)) {
      const page = pages.get(previous.versionId + ':' + previous.pageId);
      page?.dwells.push(Math.max(0, Date.parse(last.at) - Date.parse(previous.at)));
      if (last.state !== 'completed' && page) page.dropOff++;
    }
    eligible += required.size;
    acknowledged += [...required].filter((id) => read.has(id)).length;
  }
  const all = [...sessions.values()],
    summary = all.length
      ? stats('all', all)
      : { sessions: 0, completed: 0, completionRate: 0, meanDurationMs: null };
  const variants = [...variantGroups].map(([key, rows]) => ({
    ...stats(key.split('|')[1] ?? '', rows),
    experimentId: key.split('|')[0] ?? '',
  }));
  const comparisons: AnalyticsDashboard['comparisons'] = [];
  for (let i = 0; i < variants.length; i++)
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i],
        b = variants[j];
      if (a?.experimentId === b?.experimentId && a && b)
        comparisons.push({
          experimentId: a.experimentId,
          a: a.key,
          b: b.key,
          ...significance(a, b),
        });
    }
  // Bonferroni adjustment within each experiment prevents multi-variant false discovery inflation.
  for (const c of comparisons) {
    const count = comparisons.filter((v) => v.experimentId === c.experimentId).length;
    if (c.pValue !== null) c.pValue = Math.min(1, c.pValue * count);
    c.significant = c.pValue !== null && c.pValue < 0.05;
  }
  const active = all.flatMap((rows) => {
    const first = rows[0],
      last = rows.at(-1);
    return first &&
      last &&
      !terminal.has(last.state) &&
      now.getTime() - Date.parse(last.at) < 30 * 60_000
      ? [
          {
            sessionId: first.sessionId,
            scriptId: first.scriptId,
            campaignId: first.campaignId,
            agent: agents ? first.agent : null,
            state: last.state,
            since: first.at,
          },
        ]
      : [];
  });
  const activeIds = new Set(active.map((a) => a.sessionId));
  const campaigns = new Map<string, { key: string; active: number; completed: number }>();
  for (const rows of all) {
    const first = rows[0],
      last = rows.at(-1);
    if (!first || !last) continue;
    const key = first.campaignId ?? 'unassigned',
      c = campaigns.get(key) ?? { key, active: 0, completed: 0 };
    if (activeIds.has(first.sessionId)) c.active++;
    if (last.state === 'completed') c.completed++;
    campaigns.set(key, c);
  }
  return {
    generatedAt: now.toISOString(),
    sampleEvents: events.length,
    ...summary,
    scripts: [...scripts].map(([k, r]) => stats(k, r)),
    agents: [...agentGroups].map(([k, r]) => stats(k, r)),
    pages: [...pages].map(([key, p]) => ({
      key,
      visits: p.visits,
      sessions: p.sessionIds.size,
      meanDwellMs: mean(p.dwells),
      dropOff: p.dropOff,
      dropOffRate: p.dropOff / p.sessionIds.size,
    })),
    paths: [...paths.values()].sort((a, b) => b.count - a.count),
    outcomes: [...outcomes].map(([key, count]) => ({ key, count })),
    sources: [...sources].map(([key, s]) => ({
      key,
      calls: s.calls,
      meanLatencyMs: mean(s.durations) ?? 0,
      errorRate: s.errors / s.calls,
    })),
    heatmap: [...heat.values()].map(({ dwells, ...h }) => ({ ...h, meanDwellMs: mean(dwells) })),
    compliance: { eligible, acknowledged, rate: eligible ? acknowledged / eligible : null },
    variants,
    comparisons,
    active,
    liveCampaigns: [...campaigns.values()],
  };
}
