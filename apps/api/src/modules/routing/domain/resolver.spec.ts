import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bucketOf } from './ab.js';
import {
  compareCandidates,
  localeMatches,
  resolveScript,
  specificityOf,
  type CampaignSnapshot,
  type CandidateAssignment,
  type ResolveContext,
  type VersionRef,
} from './resolver.js';

const AT = new Date('2026-10-01T10:00:00.000Z');
const T0 = new Date('2026-01-01T00:00:00.000Z');

function assignment(id: string, overrides: Partial<CandidateAssignment> = {}): CandidateAssignment {
  return {
    id,
    scriptId: `s-${id}`,
    scriptStatus: 'active',
    priority: 100,
    effectiveFrom: null,
    effectiveTo: null,
    conditions: {},
    expression: null,
    versionPolicy: 'latestPublished',
    pinnedVersionId: null,
    variants: null,
    createdAt: T0,
    ...overrides,
  };
}

function version(
  scriptId: string,
  number: number,
  state: VersionRef['state'] = 'published',
  id = `${scriptId}-v${String(number)}`,
): VersionRef {
  return { id, scriptId, number, semver: `${String(number)}.0.0`, checksum: `c-${id}`, state };
}

function snapshot(
  assignments: CandidateAssignment[],
  extraVersions: VersionRef[] = [],
  campaign: Partial<CampaignSnapshot['campaign']> = {},
): CampaignSnapshot {
  return {
    campaign: {
      id: 'camp',
      code: 'CAMP',
      status: 'active',
      channels: [],
      startsAt: null,
      endsAt: null,
      workingHours: null,
      ...campaign,
    },
    assignments,
    versions: [...assignments.map((a) => version(a.scriptId, 1)), ...extraVersions],
  };
}

const ctx = (overrides: Partial<ResolveContext> = {}): ResolveContext => ({
  channel: 'voice',
  at: AT,
  ...overrides,
});

interface Case {
  readonly name: string;
  readonly assignments: CandidateAssignment[];
  readonly versions?: VersionRef[];
  /** Drop the default published v1 of every script. */
  readonly noVersions?: boolean;
  readonly campaign?: Partial<CampaignSnapshot['campaign']>;
  readonly context?: Partial<ResolveContext>;
  readonly winner: string | null;
  readonly reason?: string;
  readonly version?: string;
  readonly rejected?: Record<string, string[]>;
}

const CASES: Case[] = [
  // ─── basics ───
  {
    name: 'single unconstrained assignment wins',
    assignments: [assignment('a')],
    winner: 'a',
    version: 's-a-v1',
  },
  { name: 'no assignments → no_match', assignments: [], winner: null, reason: 'no_assignments' },
  {
    name: 'lower priority value wins',
    assignments: [assignment('a', { priority: 200 }), assignment('b', { priority: 10 })],
    winner: 'b',
  },
  // ─── campaign gates ───
  {
    name: 'paused campaign → no_match',
    assignments: [assignment('a')],
    campaign: { status: 'paused' },
    winner: null,
    reason: 'campaign_inactive',
  },
  {
    name: 'draft campaign → no_match',
    assignments: [assignment('a')],
    campaign: { status: 'draft' },
    winner: null,
    reason: 'campaign_inactive',
  },
  {
    name: 'campaign not started',
    assignments: [assignment('a')],
    campaign: { startsAt: new Date('2026-11-01T00:00:00Z') },
    winner: null,
    reason: 'campaign_out_of_window',
  },
  {
    name: 'campaign ended (end exclusive)',
    assignments: [assignment('a')],
    campaign: { endsAt: AT },
    winner: null,
    reason: 'campaign_out_of_window',
  },
  {
    name: 'channel not served by campaign',
    assignments: [assignment('a')],
    campaign: { channels: ['chat'] },
    winner: null,
    reason: 'channel_not_in_campaign',
  },
  {
    name: 'channel served by campaign',
    assignments: [assignment('a')],
    campaign: { channels: ['chat', 'voice'] },
    winner: 'a',
  },
  // ─── effective window ───
  {
    name: 'not yet effective',
    assignments: [assignment('a', { effectiveFrom: new Date('2026-10-02T00:00:00Z') })],
    winner: null,
    reason: 'no_eligible_assignment',
    rejected: { a: ['not_yet_effective'] },
  },
  {
    name: 'effective from is inclusive',
    assignments: [assignment('a', { effectiveFrom: AT })],
    winner: 'a',
  },
  {
    name: 'effective to is exclusive',
    assignments: [assignment('a', { effectiveTo: AT })],
    winner: null,
    rejected: { a: ['expired'] },
  },
  {
    name: 'expired falls back to the next',
    assignments: [
      assignment('a', { priority: 1, effectiveTo: new Date('2026-09-01T00:00:00Z') }),
      assignment('b', { priority: 2 }),
    ],
    winner: 'b',
    rejected: { a: ['expired'] },
  },
  // ─── context dimensions ───
  {
    name: 'channel condition matches',
    assignments: [assignment('a', { conditions: { channels: ['voice'] } })],
    winner: 'a',
  },
  {
    name: 'channel condition mismatch',
    assignments: [assignment('a', { conditions: { channels: ['chat'] } })],
    winner: null,
    rejected: { a: ['channel_mismatch'] },
  },
  {
    name: 'locale prefix tr matches tr-TR',
    assignments: [assignment('a', { conditions: { locales: ['tr'] } })],
    context: { locale: 'tr-TR' },
    winner: 'a',
  },
  {
    name: 'locale tr-TR does not match en',
    assignments: [assignment('a', { conditions: { locales: ['tr-TR'] } })],
    context: { locale: 'en' },
    winner: null,
    rejected: { a: ['locale_mismatch'] },
  },
  {
    name: 'locale required but missing in context',
    assignments: [assignment('a', { conditions: { locales: ['tr'] } })],
    winner: null,
    rejected: { a: ['locale_mismatch'] },
  },
  {
    name: 'queue matches',
    assignments: [assignment('a', { conditions: { queues: ['q-sales', 'q-vip'] } })],
    context: { queue: 'q-vip' },
    winner: 'a',
  },
  {
    name: 'queue mismatch',
    assignments: [assignment('a', { conditions: { queues: ['q-sales'] } })],
    context: { queue: 'q-care' },
    winner: null,
    rejected: { a: ['queue_mismatch'] },
  },
  {
    name: 'skills: any overlap matches',
    assignments: [assignment('a', { conditions: { skills: ['tr', 'cards'] } })],
    context: { skills: ['cards'] },
    winner: 'a',
  },
  {
    name: 'skills: no overlap',
    assignments: [assignment('a', { conditions: { skills: ['loans'] } })],
    context: { skills: ['cards'] },
    winner: null,
    rejected: { a: ['skill_mismatch'] },
  },
  {
    name: 'segment matches',
    assignments: [assignment('a', { conditions: { segments: ['gold'] } })],
    context: { segment: 'gold' },
    winner: 'a',
  },
  {
    name: 'segment mismatch',
    assignments: [assignment('a', { conditions: { segments: ['gold'] } })],
    context: { segment: 'silver' },
    winner: null,
    rejected: { a: ['segment_mismatch'] },
  },
  {
    name: 'all mismatches are reported',
    assignments: [
      assignment('a', { conditions: { channels: ['chat'], queues: ['q'], segments: ['g'] } }),
    ],
    winner: null,
    rejected: { a: ['channel_mismatch', 'queue_mismatch', 'segment_mismatch'] },
  },
  // ─── expression over attached data ───
  {
    name: 'expression true on attached data',
    assignments: [
      assignment('a', { expression: { fact: 'interaction.balance', op: 'gt', value: 1000 } }),
    ],
    context: { attributes: { balance: 5000 } },
    winner: 'a',
  },
  {
    name: 'expression false',
    assignments: [
      assignment('a', { expression: { fact: 'interaction.balance', op: 'gt', value: 1000 } }),
    ],
    context: { attributes: { balance: 10 } },
    winner: null,
    rejected: { a: ['expression_false'] },
  },
  {
    name: 'expression on agent attributes',
    assignments: [
      assignment('a', { expression: { fact: 'agent.tier', op: 'eq', value: 'senior' } }),
    ],
    context: { agent: { id: 'ag', attributes: { tier: 'senior' } } },
    winner: 'a',
  },
  {
    name: 'expression with all/any/not',
    assignments: [
      assignment('a', {
        expression: {
          all: [
            { fact: 'interaction.channel', op: 'eq', value: 'voice' },
            { not: { fact: 'interaction.vip', op: 'eq', value: true } },
          ],
        },
      }),
    ],
    context: { attributes: { vip: false } },
    winner: 'a',
  },
  {
    name: '$expr fails closed until the engine exists',
    assignments: [assignment('a', { expression: { $expr: 'vars.x > 1' } as never })],
    winner: null,
    rejected: { a: ['expression_unsupported'] },
  },
  {
    name: 'missing fact never matches gt',
    assignments: [
      assignment('a', { expression: { fact: 'interaction.nope', op: 'gt', value: 0 } }),
    ],
    winner: null,
    rejected: { a: ['expression_false'] },
  },
  // ─── versions ───
  {
    name: 'latestPublished picks the highest published number',
    assignments: [assignment('a')],
    versions: [version('s-a', 3), version('s-a', 2), version('s-a', 4, 'approved')],
    winner: 'a',
    version: 's-a-v3',
  },
  {
    name: 'no published version → rejected',
    assignments: [assignment('a')],
    noVersions: true,
    winner: null,
    rejected: { a: ['no_published_version'] },
  },
  {
    name: 'pinned published version is used',
    assignments: [assignment('a', { versionPolicy: 'pinned', pinnedVersionId: 's-a-v2' })],
    versions: [version('s-a', 2), version('s-a', 5)],
    winner: 'a',
    version: 's-a-v2',
  },
  {
    name: 'pinned retired version → rejected, next wins',
    assignments: [
      assignment('a', { priority: 1, versionPolicy: 'pinned', pinnedVersionId: 's-a-v2' }),
      assignment('b', { priority: 2 }),
    ],
    versions: [version('s-a', 2, 'retired')],
    winner: 'b',
    rejected: { a: ['pinned_version_not_published'] },
  },
  {
    name: 'pin of another script is ignored as not published',
    assignments: [assignment('a', { versionPolicy: 'pinned', pinnedVersionId: 's-x-v1' })],
    versions: [version('s-x', 1)],
    winner: null,
    rejected: { a: ['pinned_version_not_published'] },
  },
  {
    name: 'archived script is skipped',
    assignments: [
      assignment('a', { priority: 1, scriptStatus: 'archived' }),
      assignment('b', { priority: 5 }),
    ],
    winner: 'b',
    rejected: { a: ['script_archived'] },
  },
  // ─── tie-breaking ───
  {
    name: 'equal priority: more specific wins',
    assignments: [assignment('a'), assignment('b', { conditions: { channels: ['voice'] } })],
    winner: 'b',
  },
  {
    name: 'equal priority+specificity: more recent effectiveFrom wins',
    assignments: [
      assignment('a', { effectiveFrom: new Date('2026-01-01T00:00:00Z') }),
      assignment('b', { effectiveFrom: new Date('2026-06-01T00:00:00Z') }),
    ],
    winner: 'b',
  },
  {
    name: 'then most recently created wins',
    assignments: [
      assignment('a', { createdAt: new Date('2026-02-01T00:00:00Z') }),
      assignment('b', { createdAt: new Date('2026-03-01T00:00:00Z') }),
    ],
    winner: 'b',
  },
  {
    name: 'finally the smallest id wins',
    assignments: [assignment('b'), assignment('a')],
    winner: 'a',
  },
];

describe('ScriptResolver — decision table', () => {
  it.each(CASES)('$name', (c) => {
    const snap = snapshot(c.assignments, c.versions ?? [], c.campaign ?? {});
    const decision = resolveScript(
      c.noVersions === true ? { ...snap, versions: [] } : snap,
      ctx(c.context),
    );
    if (c.winner === null) {
      expect(decision.outcome).toBe('no_match');
      if (c.reason !== undefined) expect(decision.reason).toBe(c.reason);
    } else {
      expect(decision.outcome).toBe('resolved');
      expect(decision.assignmentId).toBe(c.winner);
    }
    if (c.version !== undefined) expect(decision.version?.id).toBe(c.version);
    for (const [id, reasons] of Object.entries(c.rejected ?? {})) {
      expect(decision.trace.evaluated.find((e) => e.assignmentId === id)?.reasons).toEqual(reasons);
    }
  });
});

describe('ScriptResolver — explanation', () => {
  it('traces every candidate, the ranking and facts read', () => {
    const decision = resolveScript(
      snapshot([
        assignment('a', { priority: 1, conditions: { channels: ['chat'] } }),
        assignment('b', {
          priority: 2,
          expression: { fact: 'interaction.balance', op: 'gte', value: 1 },
        }),
        assignment('c', { priority: 3 }),
      ]),
      ctx({ attributes: { balance: 3 } }),
    );
    expect(decision.trace.evaluated.map((e) => [e.assignmentId, e.eligible])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
    ]);
    expect(decision.trace.ranking).toEqual(['b', 'c']);
    expect(decision.trace.evaluated[1]?.factsRead).toEqual(['interaction.balance']);
    expect(decision.trace.at).toBe(AT.toISOString());
    expect(decision.trace.tie).toBeNull();
  });

  it('reports ties and how they were broken', () => {
    const recency = resolveScript(
      snapshot([assignment('a', { createdAt: new Date('2026-02-01T00:00:00Z') }), assignment('b')]),
      ctx(),
    );
    expect(recency.trace.tie).toEqual({ assignmentIds: ['a', 'b'], brokenBy: 'recency' });
    const byId = resolveScript(
      snapshot([assignment('b'), assignment('a'), assignment('c', { priority: 1 })]),
      ctx(),
    );
    expect(byId.assignmentId).toBe('c');
    expect(byId.trace.tie).toBeNull();
    const pure = resolveScript(snapshot([assignment('b'), assignment('a')]), ctx());
    expect(pure.trace.tie).toEqual({ assignmentIds: ['a', 'b'], brokenBy: 'id' });
  });

  it('blocks resolution outside working hours', () => {
    const hours = {
      timezone: 'Europe/Istanbul',
      weekly: { thu: [{ from: '09:00', to: '12:00' }] },
      holidays: [],
    };
    // 2026-10-01 is a Thursday; 10:00Z = 13:00 Istanbul → closed.
    const closed = resolveScript(snapshot([assignment('a')], [], { workingHours: hours }), ctx());
    expect(closed).toMatchObject({
      outcome: 'no_match',
      reason: 'outside_working_hours',
      workingHours: { configured: true, open: false },
    });
    const open = resolveScript(
      snapshot([assignment('a')], [], { workingHours: hours }),
      ctx({ at: new Date('2026-10-01T07:30:00Z') }),
    );
    expect(open.workingHours.open).toBe(true);
  });
});

describe('ScriptResolver — A/B variants', () => {
  const variants = [
    { key: 'control', weight: 5000 },
    { key: 'treatment', weight: 5000, pinnedVersionId: 's-a-v2' },
  ];
  const snap = snapshot(
    [assignment('a', { variants, versionPolicy: 'pinned', pinnedVersionId: 's-a-v1' })],
    [version('s-a', 2)],
  );

  it('is sticky: the same key always gets the same arm', () => {
    const first = resolveScript(snap, ctx({ stickyKey: 'customer-42' }));
    for (let i = 0; i < 20; i += 1)
      expect(resolveScript(snap, ctx({ stickyKey: 'customer-42' })).variant).toEqual(first.variant);
    expect(first.variant?.bucket).toBe(bucketOf('a', 'customer-42'));
  });

  it('applies the arm version override', () => {
    const keys = Array.from({ length: 200 }, (_v, i) => `k-${String(i)}`);
    const decisions = keys.map((k) => resolveScript(snap, ctx({ stickyKey: k })));
    for (const d of decisions) {
      expect(d.version?.id).toBe(d.variant?.key === 'treatment' ? 's-a-v2' : 's-a-v1');
    }
  });

  it('splits close to the configured weights', () => {
    const counts = { control: 0, treatment: 0 };
    for (let i = 0; i < 10_000; i += 1) {
      const key = resolveScript(snap, ctx({ stickyKey: `cust-${String(i)}` })).variant
        ?.key as keyof typeof counts;
      counts[key] += 1;
    }
    expect(counts.control).toBeGreaterThan(4700);
    expect(counts.treatment).toBeGreaterThan(4700);
  });

  it('uses interactionId but skips A/B without an interaction or customer key', () => {
    const a = resolveScript(snap, ctx({ interactionId: 'i-1' }));
    expect(a.variant?.bucket).toBe(bucketOf('a', 'i-1'));
    const b = resolveScript(snap, ctx({ agent: { id: 'ag-7' } }));
    expect(b.variant).toBeUndefined();
    expect(b.trace).toMatchObject({ abSkipped: 'missing_sticky_key' });
  });

  it('an unpublished arm version falls back to the assignment version', () => {
    const unpublished = snapshot(
      [assignment('a', { variants: [{ key: 'x', weight: 10_000, pinnedVersionId: 's-a-v9' }] })],
      [version('s-a', 9, 'approved')],
    );
    const result = resolveScript(unpublished, ctx({ stickyKey: 'k' }));
    expect(result.version?.id).toBe('s-a-v1');
    expect(result.variant).toBeUndefined();
    expect(result.trace).toMatchObject({ abSkipped: 'variant_not_published' });
  });
});

describe('ScriptResolver — determinism', () => {
  const arb = fc.array(
    fc.record({
      priority: fc.integer({ min: 0, max: 3 }),
      channels: fc.subarray(['voice', 'chat']),
      queues: fc.subarray(['q1', 'q2']),
      from: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
      created: fc.integer({ min: 0, max: 3 }),
    }),
    { minLength: 1, maxLength: 8 },
  );

  it('property: input order never changes the decision', () => {
    fc.assert(
      fc.property(
        arb,
        fc.constantFrom('voice', 'chat'),
        fc.constantFrom('q1', 'q2', undefined),
        (specs, channel, queue) => {
          const list = specs.map((s, i) =>
            assignment(`a${String(i)}`, {
              priority: s.priority,
              conditions: { channels: s.channels, queues: s.queues },
              effectiveFrom: s.from === null ? null : new Date(Date.UTC(2026, s.from, 1)),
              createdAt: new Date(Date.UTC(2025, s.created, 1)),
            }),
          );
          const context = ctx({ channel, ...(queue === undefined ? {} : { queue }) });
          const forward = resolveScript(snapshot(list), context);
          const reversed = resolveScript(snapshot([...list].reverse()), context);
          expect(reversed.assignmentId).toBe(forward.assignmentId);
          expect(reversed.trace.ranking).toEqual(forward.trace.ranking);
        },
      ),
      { numRuns: 300, seed: 7 },
    );
  });

  it('property: the winner is minimal under the total order among eligible candidates', () => {
    fc.assert(
      fc.property(arb, (specs) => {
        const list = specs.map((s, i) =>
          assignment(`a${String(i)}`, {
            priority: s.priority,
            conditions: { channels: s.channels },
          }),
        );
        const decision = resolveScript(snapshot(list), ctx());
        if (decision.outcome !== 'resolved') return;
        const eligible = list.filter((a) => decision.trace.ranking.includes(a.id));
        const best = [...eligible].sort(compareCandidates)[0];
        expect(decision.assignmentId).toBe(best?.id);
      }),
      { numRuns: 300, seed: 11 },
    );
  });
});

describe('helpers', () => {
  it('specificity counts constrained dimensions, expression and window', () => {
    expect(specificityOf(assignment('a'))).toBe(0);
    expect(
      specificityOf(
        assignment('a', {
          conditions: { channels: ['voice'], queues: [] },
          expression: { fact: 'interaction.x', op: 'exists' },
          effectiveTo: AT,
        }),
      ),
    ).toBe(3);
  });

  it.each([
    [[], undefined, true],
    [['tr'], 'tr', true],
    [['tr'], 'TR-tr', true],
    [['tr-TR'], 'tr', false],
    [['en', 'tr'], 'tr-CY', true],
    [['tr'], 'trk', false],
  ] as const)('localeMatches(%j, %s) = %s', (allowed, locale, expected) => {
    expect(localeMatches(allowed, locale)).toBe(expected);
  });
});

describe('authoritative release head', () => {
  it('routes latestPublished to the rollback head while explicit pins keep their version', () => {
    const a = assignment('a'),
      snap = {
        ...snapshot([a]),
        versions: [
          { ...version(a.scriptId, 1), current: true },
          { ...version(a.scriptId, 2), current: false },
        ],
      };
    expect(resolveScript(snap, ctx())).toMatchObject({
      outcome: 'resolved',
      version: { number: 1 },
    });
    const pinned = {
      ...a,
      versionPolicy: 'pinned' as const,
      pinnedVersionId: version(a.scriptId, 2).id,
    };
    expect(resolveScript({ ...snap, assignments: [pinned] }, ctx())).toMatchObject({
      outcome: 'resolved',
      version: { number: 2 },
    });
  });
  it('does not silently pick a newer release when an authoritative head is unavailable', () => {
    const a = assignment('a'),
      snap = { ...snapshot([a]), versions: [{ ...version(a.scriptId, 1), current: false }] };
    expect(resolveScript(snap, ctx())).toMatchObject({ outcome: 'no_match' });
  });
});

describe('same script assigned to multiple campaigns', () => {
  it('resolves independent campaign pins and never borrows another campaign assignment', () => {
    const scriptId = 'shared-script';
    const first = assignment('campaign-a-link', {
      scriptId,
      versionPolicy: 'pinned',
      pinnedVersionId: 'shared-v1',
    });
    const second = assignment('campaign-b-link', {
      scriptId,
      versionPolicy: 'pinned',
      pinnedVersionId: 'shared-v2',
    });
    const versions = [
      version(scriptId, 1, 'published', 'shared-v1'),
      version(scriptId, 2, 'published', 'shared-v2'),
    ];
    const a = { ...snapshot([first], [], { id: 'campaign-a' }), versions };
    const b = { ...snapshot([second], [], { id: 'campaign-b' }), versions };
    expect(resolveScript(a, ctx())).toMatchObject({
      outcome: 'resolved',
      assignmentId: first.id,
      version: { id: 'shared-v1' },
    });
    expect(resolveScript(b, ctx())).toMatchObject({
      outcome: 'resolved',
      assignmentId: second.id,
      version: { id: 'shared-v2' },
    });
    expect(resolveScript({ ...b, assignments: [] }, ctx())).toMatchObject({ outcome: 'no_match' });
  });
});

describe('routing safety properties', () => {
  it('never labels a fallback version as an unpublished experiment arm', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.constantFrom('draft', 'approved', 'retired'),
        (stickyKey, state) => {
          const snap = snapshot(
            [
              assignment('a', {
                variants: [{ key: 'experiment', weight: 10000, pinnedVersionId: 'unavailable' }],
              }),
            ],
            [version('s-a', 2, state as VersionRef['state'], 'unavailable')],
          );
          const decision = resolveScript(snap, ctx({ stickyKey }));
          expect(decision.version?.id).toBe('s-a-v1');
          expect(decision.variant).toBeUndefined();
          expect(decision.trace).toMatchObject({ abSkipped: 'variant_not_published' });
        },
      ),
      { seed: 603, numRuns: 200 },
    );
  });
  it('no weekday may route a campaign with no open intervals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000000 }), (minutes) => {
        const decision = resolveScript(
          snapshot([assignment('a')], [], {
            workingHours: { timezone: 'UTC', weekly: {}, holidays: [] },
          }),
          ctx({ at: new Date(AT.getTime() + minutes * 60000) }),
        );
        expect(decision).toMatchObject({ outcome: 'no_match', reason: 'outside_working_hours' });
      }),
      { seed: 604, numRuns: 200 },
    );
  });
});

it('property: a customer key assigns the same A/B bucket across agents and interactions', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 128 }).filter((key) => key.trim().length > 0),
      fc.uuid(),
      fc.uuid(),
      (stickyKey, firstAgent, secondAgent) => {
        const snap = snapshot([
          assignment('ab', {
            variants: [
              { key: 'a', weight: 5000 },
              { key: 'b', weight: 5000 },
            ],
          }),
        ]);
        const first = resolveScript(
          snap,
          ctx({ stickyKey, interactionId: 'first', agent: { id: firstAgent } }),
        );
        const second = resolveScript(
          snap,
          ctx({ stickyKey, interactionId: 'second', agent: { id: secondAgent } }),
        );
        expect(second.variant).toEqual(first.variant);
        expect(first.variant).toBeDefined();
      },
    ),
    { seed: 605, numRuns: 200 },
  );
});
