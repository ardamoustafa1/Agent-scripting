import type { Predicate } from '@verbis/script-schema';

import { bucketOf, pickVariant, type Variant } from './ab.js';
import { evaluatePredicate } from './predicate.js';
import { isOpen, type WorkingHours } from './working-hours.js';

/**
 * ScriptResolver (DOMAIN Assignment, invariant 4): given an interaction context, choose exactly
 * one script version deterministically and explain why. Pure function of (snapshot, context):
 * no clock, no randomness, no I/O — `context.at` is the decision time.
 */
export interface AssignmentConditions {
  readonly channels?: readonly string[];
  readonly locales?: readonly string[];
  readonly queues?: readonly string[];
  readonly skills?: readonly string[];
  readonly segments?: readonly string[];
}

export interface CandidateAssignment {
  readonly id: string;
  readonly scriptId: string;
  readonly scriptStatus: 'draft' | 'active' | 'archived';
  readonly priority: number;
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
  readonly conditions: AssignmentConditions;
  readonly expression: Predicate | null;
  readonly versionPolicy: 'pinned' | 'latestPublished';
  readonly pinnedVersionId: string | null;
  readonly variants: readonly Variant[] | null;
  readonly createdAt: Date;
}

export interface VersionRef {
  /** Authoritative release head; absent only in legacy snapshots. */
  readonly current?: boolean;
  readonly id: string;
  readonly scriptId: string;
  readonly number: number;
  readonly semver: string | null;
  readonly checksum: string;
  readonly state: 'draft' | 'in_review' | 'approved' | 'published' | 'retired';
}

export interface CampaignSnapshot {
  readonly campaign: {
    readonly id: string;
    readonly code: string | null;
    readonly status: 'draft' | 'active' | 'paused' | 'archived';
    readonly channels: readonly string[];
    readonly startsAt: Date | null;
    readonly endsAt: Date | null;
    readonly workingHours: WorkingHours | null;
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
  readonly assignments: readonly CandidateAssignment[];
  /** Every version referenced by a pin/variant, plus each script's published versions. */
  readonly versions: readonly VersionRef[];
}

export interface ResolveContext {
  readonly channel: string;
  readonly locale?: string;
  readonly queue?: string;
  readonly skills?: readonly string[];
  readonly segment?: string;
  /** Attached data from the platform (already allow-listed by the connector). */
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly agent?: { readonly id: string; readonly attributes?: Readonly<Record<string, unknown>> };
  readonly interactionId?: string;
  /** A/B stickiness (customer id, ANI hash…); defaults to interactionId. Never falls back to agent id. */
  readonly stickyKey?: string;
  readonly at: Date;
}

export type RejectReason =
  | 'not_yet_effective'
  | 'expired'
  | 'channel_mismatch'
  | 'locale_mismatch'
  | 'queue_mismatch'
  | 'skill_mismatch'
  | 'segment_mismatch'
  | 'expression_false'
  | 'expression_unsupported'
  | 'script_archived'
  | 'pinned_version_not_published'
  | 'no_published_version';

export interface Evaluation {
  readonly assignmentId: string;
  readonly priority: number;
  readonly specificity: number;
  readonly eligible: boolean;
  readonly reasons: readonly RejectReason[];
  readonly factsRead: readonly string[];
}

export type NoMatchReason =
  | 'outside_working_hours'
  | 'campaign_inactive'
  | 'campaign_out_of_window'
  | 'channel_not_in_campaign'
  | 'no_assignments'
  | 'no_eligible_assignment';

export interface Decision {
  readonly outcome: 'resolved' | 'no_match';
  readonly reason?: NoMatchReason;
  readonly campaignId: string;
  readonly assignmentId?: string;
  readonly scriptId?: string;
  readonly version?: {
    readonly id: string;
    readonly number: number;
    readonly semver: string | null;
    readonly checksum: string;
  };
  readonly variant?: { readonly key: string; readonly bucket: number };
  readonly workingHours: { readonly configured: boolean; readonly open: boolean };
  readonly trace: {
    readonly evaluated: readonly Evaluation[];
    /** Eligible assignment ids in final order. */
    readonly ranking: readonly string[];
    /** Set when the winner shares priority and specificity with the runner-up. */
    readonly tie: {
      readonly assignmentIds: readonly string[];
      readonly brokenBy: 'recency' | 'id';
    } | null;
    readonly at: string;
    readonly abSkipped?: 'missing_sticky_key' | 'variant_not_published';
  };
}

const lower = (v: string): string => v.toLowerCase();

/** `tr` matches `tr-TR`; `tr-TR` matches only itself (and `tr-tr`). */
export function localeMatches(allowed: readonly string[], locale: string | undefined): boolean {
  if (allowed.length === 0) return true;
  if (locale === undefined) return false;
  const l = lower(locale);
  return allowed.some((a) => {
    const x = lower(a);
    return l === x || l.startsWith(`${x}-`);
  });
}

const constrained = (list: readonly string[] | undefined): list is readonly string[] =>
  list !== undefined && list.length > 0;

/** Number of constrained dimensions: a narrower assignment beats a broader one at equal priority. */
export function specificityOf(a: CandidateAssignment): number {
  const c = a.conditions;
  return (
    [c.channels, c.locales, c.queues, c.skills, c.segments].filter(constrained).length +
    (a.expression === null ? 0 : 1) +
    (a.effectiveFrom === null && a.effectiveTo === null ? 0 : 1)
  );
}

export function factsFor(
  snapshot: CampaignSnapshot,
  context: ResolveContext,
): Record<string, unknown> {
  return {
    interaction: {
      ...(context.attributes ?? {}),
      channel: context.channel,
      locale: context.locale,
      queue: context.queue,
      skills: context.skills ?? [],
      segment: context.segment,
      id: context.interactionId,
    },
    agent: { ...(context.agent?.attributes ?? {}), id: context.agent?.id },
    campaign: {
      ...(snapshot.campaign.attributes ?? {}),
      id: snapshot.campaign.id,
      code: snapshot.campaign.code,
    },
  };
}

function versionFor(
  snapshot: CampaignSnapshot,
  assignment: CandidateAssignment,
  pinned: string | null,
): { version?: VersionRef; reason?: RejectReason } {
  if (pinned !== null) {
    const version = snapshot.versions.find(
      (v) => v.id === pinned && v.scriptId === assignment.scriptId,
    );
    return version?.state === 'published'
      ? { version }
      : { reason: 'pinned_version_not_published' };
  }
  const published = snapshot.versions
    .filter((v) => v.scriptId === assignment.scriptId && v.state === 'published')
    .sort((a, b) => b.number - a.number);
  const latest =
    published.find((v) => v.current === true) ??
    (published.some((v) => v.current !== undefined) ? undefined : published[0]);
  return latest === undefined ? { reason: 'no_published_version' } : { version: latest };
}

export function evaluateAssignment(
  snapshot: CampaignSnapshot,
  assignment: CandidateAssignment,
  context: ResolveContext,
  facts: Record<string, unknown>,
): Evaluation & { version?: VersionRef } {
  const reasons: RejectReason[] = [];
  const at = context.at.getTime();
  const c = assignment.conditions;
  if (assignment.effectiveFrom !== null && at < assignment.effectiveFrom.getTime())
    reasons.push('not_yet_effective');
  if (assignment.effectiveTo !== null && at >= assignment.effectiveTo.getTime())
    reasons.push('expired');
  if (constrained(c.channels) && !c.channels.includes(context.channel))
    reasons.push('channel_mismatch');
  if (!localeMatches(c.locales ?? [], context.locale)) reasons.push('locale_mismatch');
  if (constrained(c.queues) && (context.queue === undefined || !c.queues.includes(context.queue)))
    reasons.push('queue_mismatch');
  const skills = c.skills ?? [];
  if (skills.length > 0 && !(context.skills ?? []).some((s) => skills.includes(s)))
    reasons.push('skill_mismatch');
  if (
    constrained(c.segments) &&
    (context.segment === undefined || !c.segments.includes(context.segment))
  )
    reasons.push('segment_mismatch');
  let factsRead: readonly string[] = [];
  if (assignment.expression !== null) {
    const result = evaluatePredicate(assignment.expression, facts);
    factsRead = result.facts;
    if (result.unsupported) reasons.push('expression_unsupported');
    else if (!result.value) reasons.push('expression_false');
  }
  if (assignment.scriptStatus === 'archived') reasons.push('script_archived');
  const pinned = assignment.versionPolicy === 'pinned' ? assignment.pinnedVersionId : null;
  const resolved = versionFor(snapshot, assignment, pinned);
  if (resolved.reason !== undefined) reasons.push(resolved.reason);
  return {
    assignmentId: assignment.id,
    priority: assignment.priority,
    specificity: specificityOf(assignment),
    eligible: reasons.length === 0,
    reasons,
    factsRead,
    ...(resolved.version === undefined ? {} : { version: resolved.version }),
  };
}

/** Total order: priority ↑, specificity ↓, effectiveFrom ↓ (recent first), createdAt ↓, id ↑. */
export function compareCandidates(a: CandidateAssignment, b: CandidateAssignment): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const sa = specificityOf(a);
  const sb = specificityOf(b);
  if (sa !== sb) return sb - sa;
  const fa = a.effectiveFrom?.getTime() ?? -Infinity;
  const fb = b.effectiveFrom?.getTime() ?? -Infinity;
  if (fa !== fb) return fb > fa ? 1 : -1;
  if (a.createdAt.getTime() !== b.createdAt.getTime())
    return b.createdAt.getTime() - a.createdAt.getTime();
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function resolveScript(snapshot: CampaignSnapshot, context: ResolveContext): Decision {
  const { campaign } = snapshot;
  const at = context.at.getTime();
  const workingHours = {
    configured: campaign.workingHours !== null,
    open: campaign.workingHours === null ? true : isOpen(campaign.workingHours, context.at),
  };
  const base = { campaignId: campaign.id, workingHours };
  const empty = { evaluated: [], ranking: [], tie: null, at: context.at.toISOString() };
  if (campaign.status !== 'active')
    return { ...base, outcome: 'no_match', reason: 'campaign_inactive', trace: empty };
  if (
    (campaign.startsAt !== null && at < campaign.startsAt.getTime()) ||
    (campaign.endsAt !== null && at >= campaign.endsAt.getTime())
  ) {
    return { ...base, outcome: 'no_match', reason: 'campaign_out_of_window', trace: empty };
  }
  if (campaign.channels.length > 0 && !campaign.channels.includes(context.channel)) {
    return { ...base, outcome: 'no_match', reason: 'channel_not_in_campaign', trace: empty };
  }
  if (!workingHours.open)
    return { ...base, outcome: 'no_match', reason: 'outside_working_hours', trace: empty };
  if (snapshot.assignments.length === 0)
    return { ...base, outcome: 'no_match', reason: 'no_assignments', trace: empty };

  const facts = factsFor(snapshot, context);
  // Evaluate in a stable order so the trace itself is deterministic.
  const ordered = [...snapshot.assignments].sort(compareCandidates);
  const evaluations = ordered.map((a) => ({
    assignment: a,
    result: evaluateAssignment(snapshot, a, context, facts),
  }));
  const eligible = evaluations.filter((e) => e.result.eligible);
  const evaluated: Evaluation[] = evaluations.map(({ result }) => ({
    assignmentId: result.assignmentId,
    priority: result.priority,
    specificity: result.specificity,
    eligible: result.eligible,
    reasons: result.reasons,
    factsRead: result.factsRead,
  }));
  const ranking = eligible.map((e) => e.assignment.id);
  const trace: Omit<Decision['trace'], 'tie'> = {
    evaluated,
    ranking,
    at: context.at.toISOString(),
  };
  const winner = eligible[0];
  if (winner === undefined)
    return {
      ...base,
      outcome: 'no_match',
      reason: 'no_eligible_assignment',
      trace: { ...trace, tie: null },
    };

  const runnerUp = eligible[1];
  const tie =
    runnerUp?.assignment.priority === winner.assignment.priority &&
    specificityOf(runnerUp.assignment) === specificityOf(winner.assignment)
      ? {
          assignmentIds: eligible
            .filter(
              (e) =>
                e.assignment.priority === winner.assignment.priority &&
                specificityOf(e.assignment) === specificityOf(winner.assignment),
            )
            .map((e) => e.assignment.id),
          brokenBy:
            (winner.assignment.effectiveFrom?.getTime() ?? -1) !==
              (runnerUp.assignment.effectiveFrom?.getTime() ?? -1) ||
            winner.assignment.createdAt.getTime() !== runnerUp.assignment.createdAt.getTime()
              ? ('recency' as const)
              : ('id' as const),
        }
      : null;

  let version = winner.result.version;
  let variant: Decision['variant'];
  const variants = winner.assignment.variants;
  let abSkipped: Decision['trace']['abSkipped'];
  if (variants !== null && variants.length > 0) {
    const requestedKey = context.stickyKey?.trim();
    const sticky =
      requestedKey === undefined || requestedKey.length === 0
        ? context.interactionId?.trim()
        : requestedKey;
    if (!sticky) abSkipped = 'missing_sticky_key';
    else {
      const bucket = bucketOf(winner.assignment.id, sticky);
      const arm = pickVariant(variants, bucket);
      if (arm !== undefined) {
        const armVersion =
          arm.pinnedVersionId === undefined
            ? { version }
            : versionFor(snapshot, winner.assignment, arm.pinnedVersionId);
        if (armVersion.version === undefined) abSkipped = 'variant_not_published';
        else {
          version = armVersion.version;
          variant = { key: arm.key, bucket };
        }
      }
    }
  }
  if (version === undefined)
    return {
      ...base,
      outcome: 'no_match',
      reason: 'no_eligible_assignment',
      trace: { ...trace, tie },
    };
  return {
    ...base,
    outcome: 'resolved',
    assignmentId: winner.assignment.id,
    scriptId: winner.assignment.scriptId,
    version: {
      id: version.id,
      number: version.number,
      semver: version.semver,
      checksum: version.checksum,
    },
    ...(variant === undefined ? {} : { variant }),
    trace: { ...trace, tie, ...(abSkipped === undefined ? {} : { abSkipped }) },
  };
}
