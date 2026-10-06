import { GENESIS_HASH, chainHash, isoMillis } from '../core/audit-event.js';

import type { BreakKind, ChainBreak } from '../core/chain-verifier.js';

/** One runtime session event as hashed (chain per session; anchored in the tenant audit chain). */
export interface ChainedSessionEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly actorId: string | null;
  readonly pageId: string | null;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly createdBy: string;
  readonly prevHash: string;
}

export function hashSessionEvent(event: ChainedSessionEvent): string {
  return chainHash(event.prevHash, {
    v: 1,
    id: event.id,
    tenantId: event.tenantId,
    sessionId: event.sessionId,
    seq: event.seq,
    type: event.type,
    payload: event.payload ?? null,
    actorId: event.actorId,
    pageId: event.pageId,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    createdBy: event.createdBy,
    prevHash: event.prevHash,
  });
}

export interface StoredSessionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly actorId: string | null;
  readonly pageId: string | null;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly createdBy: string;
  readonly prevHash: string;
  readonly hash: string;
}

export interface SessionVerifyResult {
  readonly valid: boolean;
  readonly checked: number;
  readonly lastSeq: number;
  readonly lastHash: string;
  readonly breaks: readonly ChainBreak[];
}

/** Verifies a whole session chain from genesis (rows ascending by seq). */
export function verifySessionChain(
  sessionId: string,
  rows: readonly StoredSessionRow[],
  sealed?: { seq: number; hash: string },
): SessionVerifyResult {
  const breaks: ChainBreak[] = [];
  const push = (kind: BreakKind, seq: number, expected?: string, actual?: string): void => {
    breaks.push({
      kind,
      seq: String(seq),
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    });
  };
  let expectedSeq = 1;
  let lastHash = GENESIS_HASH;
  for (const row of rows) {
    if (row.sessionId !== sessionId) push('tenant_mismatch', row.seq, sessionId, row.sessionId);
    if (row.seq !== expectedSeq)
      push('sequence_gap', row.seq, String(expectedSeq), String(row.seq));
    if (row.prevHash !== lastHash) push('link_mismatch', row.seq, lastHash, row.prevHash);
    const recomputed = hashSessionEvent({
      ...row,
      occurredAt: isoMillis(row.occurredAt),
      recordedAt: isoMillis(row.recordedAt),
    });
    if (recomputed !== row.hash) push('hash_mismatch', row.seq, recomputed, row.hash);
    lastHash = row.hash;
    expectedSeq = row.seq + 1;
  }
  const lastSeq = expectedSeq - 1;
  if (sealed !== undefined && (sealed.seq !== lastSeq || sealed.hash !== lastHash)) {
    push('checkpoint_mismatch', sealed.seq, sealed.hash, lastHash);
  }
  return { valid: breaks.length === 0, checked: rows.length, lastSeq, lastHash, breaks };
}
