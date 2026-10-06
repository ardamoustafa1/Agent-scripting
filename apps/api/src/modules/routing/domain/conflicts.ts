import { specificityOf, type CandidateAssignment } from './resolver.js';

/**
 * Static conflict detection: two assignments of one campaign with EQUAL priority whose contexts
 * can overlap (every dimension intersects, windows overlap). Expressions cannot be proven
 * disjoint statically: if they differ the conflict is `possible`, otherwise `certain`.
 */
export interface AssignmentConflict {
  readonly assignmentIds: readonly [string, string];
  readonly priority: number;
  readonly severity: 'certain' | 'possible';
  /** What the resolver would use to break the tie at runtime. */
  readonly resolvedBy: 'specificity' | 'recency' | 'id';
  readonly overlap: Readonly<
    Record<'channels' | 'locales' | 'queues' | 'skills' | 'segments', readonly string[] | 'any'>
  >;
}

type Dim = 'channels' | 'locales' | 'queues' | 'skills' | 'segments';
const DIMS: readonly Dim[] = ['channels', 'locales', 'queues', 'skills', 'segments'];

function intersect(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
  dim: Dim,
): readonly string[] | 'any' | null {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length === 0 && y.length === 0) return 'any';
  if (x.length === 0) return y;
  if (y.length === 0) return x;
  if (dim === 'locales') {
    const hit = x.filter((l) =>
      y.some(
        (m) =>
          l.toLowerCase() === m.toLowerCase() ||
          l.toLowerCase().startsWith(`${m.toLowerCase()}-`) ||
          m.toLowerCase().startsWith(`${l.toLowerCase()}-`),
      ),
    );
    return hit.length === 0 ? null : hit;
  }
  const hit = x.filter((v) => y.includes(v));
  return hit.length === 0 ? null : hit;
}

function windowsOverlap(a: CandidateAssignment, b: CandidateAssignment): boolean {
  const aStart = a.effectiveFrom?.getTime() ?? -Infinity;
  const aEnd = a.effectiveTo?.getTime() ?? Infinity;
  const bStart = b.effectiveFrom?.getTime() ?? -Infinity;
  const bEnd = b.effectiveTo?.getTime() ?? Infinity;
  return aStart < bEnd && bStart < aEnd;
}

export function detectConflicts(
  assignments: readonly CandidateAssignment[],
  now?: Date,
): AssignmentConflict[] {
  const live = assignments.filter(
    (a) =>
      a.scriptStatus !== 'archived' &&
      (now === undefined || a.effectiveTo === null || a.effectiveTo.getTime() > now.getTime()),
  );
  const sorted = [...live].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  const conflicts: AssignmentConflict[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a === undefined || b === undefined) continue;
      if (b.priority !== a.priority) break;
      if (!windowsOverlap(a, b)) continue;
      const overlap: Partial<Record<Dim, readonly string[] | 'any'>> = {};
      let disjoint = false;
      for (const dim of DIMS) {
        const hit = intersect(a.conditions[dim], b.conditions[dim], dim);
        if (hit === null) {
          disjoint = true;
          break;
        }
        overlap[dim] = hit;
      }
      if (disjoint) continue;
      const sameExpression = JSON.stringify(a.expression) === JSON.stringify(b.expression);
      const resolvedBy =
        specificityOf(a) !== specificityOf(b)
          ? 'specificity'
          : (a.effectiveFrom?.getTime() ?? 0) !== (b.effectiveFrom?.getTime() ?? 0) ||
              a.createdAt.getTime() !== b.createdAt.getTime()
            ? 'recency'
            : 'id';
      conflicts.push({
        assignmentIds: [a.id, b.id],
        priority: a.priority,
        severity: sameExpression ? 'certain' : 'possible',
        resolvedBy,
        overlap: overlap as AssignmentConflict['overlap'],
      });
    }
  }
  return conflicts;
}
