import { z } from 'zod';

/**
 * Script version lifecycle (DOMAIN §5, ADR-0015):
 *   draft → in_review → approved → published → retired
 *   in_review → draft (rejected / withdrawn), approved → draft (approval revoked by editing)
 */
export const VERSION_STATES = ['draft', 'in_review', 'approved', 'published', 'retired'] as const;
export type VersionState = (typeof VERSION_STATES)[number];

export const LIFECYCLE_ACTIONS = [
  'submit',
  'withdraw',
  'approve',
  'reject',
  'publish',
  'retire',
  'reopen',
] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export const TRANSITIONS: Readonly<
  Record<LifecycleAction, { from: readonly VersionState[]; to: VersionState }>
> = {
  submit: { from: ['draft'], to: 'in_review' },
  withdraw: { from: ['in_review'], to: 'draft' },
  approve: { from: ['in_review'], to: 'approved' },
  reject: { from: ['in_review'], to: 'draft' },
  reopen: { from: ['approved'], to: 'draft' },
  publish: { from: ['approved'], to: 'published' },
  retire: { from: ['published'], to: 'retired' },
};

export function nextState(from: VersionState, action: LifecycleAction): VersionState | undefined {
  const transition = TRANSITIONS[action];
  return transition.from.includes(from) ? transition.to : undefined;
}

/** Content may change only in draft; everything else is frozen (DB trigger enforces it too). */
export function isEditable(state: VersionState): boolean {
  return state === 'draft';
}

export const ApprovalPolicySchema = z
  .strictObject({
    /** Distinct approvals needed in the current review round. */
    requiredApprovals: z.number().int().min(1).max(10).default(1),
    /** Users who may approve (`user:<id>` or bare ids); empty = anyone with `approve Script`. */
    approverUserIds: z.array(z.string().min(1).max(128)).max(100).default([]),
    /** Role names whose holders may approve; empty = no role restriction. */
    approverRoles: z.array(z.string().min(1).max(64)).max(20).default([]),
    /** A rejection returns the version to draft immediately (default) or only counts as a vote. */
    rejectionReturnsToDraft: z.boolean().default(true),
  })
  .meta({ id: 'ApprovalPolicy' });
export type ApprovalPolicy = z.output<typeof ApprovalPolicySchema>;

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = ApprovalPolicySchema.parse({});

export interface Reviewer {
  readonly id: string;
  readonly roles: readonly string[];
}

export interface Review {
  readonly reviewer: string;
  readonly round: number;
  readonly decision: 'approved' | 'rejected' | 'commented';
}

export type EligibilityProblem =
  'author' | 'not_listed_approver' | 'missing_approver_role' | 'already_voted';

const bare = (actor: string): string => (actor.startsWith('user:') ? actor.slice(5) : actor);

/**
 * Whether `reviewer` may cast an approve/reject vote in `round`. SoD: an author (anyone who wrote
 * the version) never approves it when separation of duties is on.
 */
export function eligibility(
  policy: ApprovalPolicy,
  reviewer: Reviewer,
  authors: readonly string[],
  reviews: readonly Review[],
  round: number,
  separationOfDuties: boolean,
): EligibilityProblem[] {
  const problems: EligibilityProblem[] = [];
  const id = bare(reviewer.id);
  if (separationOfDuties && authors.map(bare).includes(id)) problems.push('author');
  if (policy.approverUserIds.length > 0 && !policy.approverUserIds.map(bare).includes(id)) {
    problems.push('not_listed_approver');
  }
  if (
    policy.approverRoles.length > 0 &&
    !reviewer.roles.some((r) => policy.approverRoles.includes(r))
  ) {
    problems.push('missing_approver_role');
  }
  if (
    reviews.some((r) => r.round === round && bare(r.reviewer) === id && r.decision !== 'commented')
  ) {
    problems.push('already_voted');
  }
  return problems;
}

/** Distinct approvals of the round reached the policy threshold (and nobody rejected). */
export function approvalReached(
  policy: ApprovalPolicy,
  reviews: readonly Review[],
  round: number,
): boolean {
  const current = reviews.filter((r) => r.round === round);
  if (current.some((r) => r.decision === 'rejected')) return false;
  const approvers = new Set(
    current.filter((r) => r.decision === 'approved').map((r) => bare(r.reviewer)),
  );
  return approvers.size >= policy.requiredApprovals;
}
