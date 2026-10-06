import { GENESIS_HASH, recomputeHash, type StoredAuditRow } from './audit-event.js';

export type BreakKind =
  | 'hash_mismatch'
  | 'link_mismatch'
  | 'sequence_gap'
  | 'tenant_mismatch'
  | 'anchor_missing'
  | 'checkpoint_mismatch'
  | 'checkpoint_signature_invalid';

export interface ChainBreak {
  readonly kind: BreakKind;
  readonly seq: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly eventId?: string;
}

/** Where verification starts: the hash the first row must link to. */
export interface ChainAnchor {
  readonly seq: bigint;
  readonly hash: string;
  /** `genesis`, the preceding event, or a signed checkpoint (archived/dropped history). */
  readonly source: 'genesis' | 'event' | 'checkpoint';
}

export interface CheckpointClaim {
  readonly id: string;
  readonly seq: bigint;
  readonly hash: string;
  readonly signatureValid: boolean;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly checked: number;
  readonly fromSeq: string | null;
  readonly toSeq: string | null;
  readonly anchor: { readonly seq: string; readonly source: ChainAnchor['source'] };
  readonly lastHash: string;
  readonly checkpointsChecked: number;
  /** First break per kind and position, capped by `maxBreaks`. */
  readonly breaks: readonly ChainBreak[];
  readonly truncated: boolean;
}

export const GENESIS_ANCHOR: ChainAnchor = { seq: 0n, hash: GENESIS_HASH, source: 'genesis' };

/**
 * Incremental verifier: feed rows in ascending `seq` (any batch size); it checks
 *  1. contiguity (no gaps, no duplicates),
 *  2. the link (`prevHash` equals the previous row's stored hash, or the anchor),
 *  3. the content (recomputed hash equals the stored hash),
 *  4. every checkpoint in range matches the stored hash at its seq and has a valid signature.
 * After a break it re-synchronizes on the stored hash so one tampered row is reported once and
 * later, independent tampering is still found.
 */
export class ChainVerifier {
  readonly #breaks: ChainBreak[] = [];
  readonly #checkpoints: Map<string, CheckpointClaim>;
  #expectedSeq: bigint;
  #lastHash: string;
  #checked = 0;
  #firstSeq: bigint | null = null;
  #lastSeq: bigint | null = null;
  #checkpointsChecked = 0;
  #truncated = false;

  constructor(
    private readonly tenantId: string,
    private readonly anchor: ChainAnchor,
    checkpoints: readonly CheckpointClaim[] = [],
    private readonly maxBreaks = 100,
  ) {
    this.#expectedSeq = anchor.seq + 1n;
    this.#lastHash = anchor.hash;
    this.#checkpoints = new Map(checkpoints.map((c) => [c.seq.toString(), c]));
  }

  #report(entry: ChainBreak): void {
    if (this.#breaks.length >= this.maxBreaks) {
      this.#truncated = true;
      return;
    }
    this.#breaks.push(entry);
  }

  push(rows: readonly StoredAuditRow[]): void {
    for (const row of rows) this.#verify(row);
  }

  #verify(row: StoredAuditRow): void {
    const seq = row.seq.toString();
    this.#checked += 1;
    this.#firstSeq ??= row.seq;
    if (row.tenantId !== this.tenantId) {
      this.#report({
        kind: 'tenant_mismatch',
        seq,
        expected: this.tenantId,
        actual: row.tenantId,
        eventId: row.id,
      });
    }
    if (row.seq !== this.#expectedSeq) {
      this.#report({
        kind: 'sequence_gap',
        seq,
        expected: this.#expectedSeq.toString(),
        actual: seq,
        eventId: row.id,
      });
    }
    if (row.prevHash !== this.#lastHash) {
      this.#report({
        kind: 'link_mismatch',
        seq,
        expected: this.#lastHash,
        actual: row.prevHash,
        eventId: row.id,
      });
    }
    const recomputed = recomputeHash(row);
    if (recomputed !== row.hash) {
      this.#report({
        kind: 'hash_mismatch',
        seq,
        expected: recomputed,
        actual: row.hash,
        eventId: row.id,
      });
    }
    const checkpoint = this.#checkpoints.get(seq);
    if (checkpoint !== undefined) {
      this.#checkpointsChecked += 1;
      if (!checkpoint.signatureValid)
        this.#report({ kind: 'checkpoint_signature_invalid', seq, eventId: checkpoint.id });
      if (checkpoint.hash !== row.hash) {
        this.#report({
          kind: 'checkpoint_mismatch',
          seq,
          expected: checkpoint.hash,
          actual: row.hash,
          eventId: checkpoint.id,
        });
      }
    }
    // Re-sync on what is stored so later independent breaks are still located.
    this.#lastHash = row.hash;
    this.#expectedSeq = row.seq + 1n;
    this.#lastSeq = row.seq;
  }

  /** The anchor event (fromSeq-1) is itself corrupt or disagrees with its checkpoint. */
  anchorTampered(
    seq: bigint,
    kind: 'hash_mismatch' | 'checkpoint_mismatch',
    expected: string,
    actual: string,
  ): void {
    this.#report({ kind, seq: seq.toString(), expected, actual });
  }

  /** Call when the anchor event itself could not be found (history removed without checkpoint). */
  anchorMissing(seq: bigint): void {
    this.#report({ kind: 'anchor_missing', seq: seq.toString() });
  }

  /** `expectedLastSeq`: when the range end is known (e.g. the chain head), a truncated tail is a gap. */
  result(expectedLastSeq?: bigint): VerifyResult {
    if (expectedLastSeq !== undefined && (this.#lastSeq ?? this.anchor.seq) < expectedLastSeq) {
      this.#report({
        kind: 'sequence_gap',
        seq: ((this.#lastSeq ?? this.anchor.seq) + 1n).toString(),
        expected: expectedLastSeq.toString(),
        actual: (this.#lastSeq ?? this.anchor.seq).toString(),
      });
    }
    return {
      valid: this.#breaks.length === 0 && !this.#truncated,
      checked: this.#checked,
      fromSeq: this.#firstSeq?.toString() ?? null,
      toSeq: this.#lastSeq?.toString() ?? null,
      anchor: { seq: this.anchor.seq.toString(), source: this.anchor.source },
      lastHash: this.#lastHash,
      checkpointsChecked: this.#checkpointsChecked,
      breaks: [...this.#breaks],
      truncated: this.#truncated,
    };
  }
}
