import { toBigInt, toInt } from './core/scalars.js';

import type { CheckpointPayload } from './core/checkpoint-signer.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

export interface CheckpointRow {
  readonly id: string;
  readonly tenantId: string;
  readonly seq: bigint;
  readonly hash: string;
  readonly sessionHeadsDigest: string;
  readonly sessionHeadsCount: number;
  readonly prevCheckpointId: string | null;
  readonly keyId: string;
  readonly signature: string;
  readonly signedAt: Date;
}

export function checkpointPayload(
  row: Omit<CheckpointRow, 'keyId' | 'signature'>,
): CheckpointPayload {
  return {
    v: 1,
    id: row.id,
    tenantId: row.tenantId,
    seq: row.seq.toString(),
    hash: row.hash,
    sessionHeadsDigest: row.sessionHeadsDigest,
    sessionHeadsCount: row.sessionHeadsCount,
    prevCheckpointId: row.prevCheckpointId,
    signedAt: row.signedAt.toISOString(),
  };
}

function normalize(row: CheckpointRow): CheckpointRow {
  return {
    ...row,
    seq: toBigInt(row.seq),
    sessionHeadsCount: toInt(row.sessionHeadsCount),
    signedAt: new Date(row.signedAt),
  };
}

export async function checkpointsInRange(
  tx: TransactionClient,
  tenantId: string,
  fromSeq: bigint,
  toSeq: bigint,
): Promise<CheckpointRow[]> {
  const rows = await tx.$queryRaw<CheckpointRow[]>`
    SELECT id, tenant_id AS "tenantId", seq, hash, session_heads_digest AS "sessionHeadsDigest",
           session_heads_count AS "sessionHeadsCount", prev_checkpoint_id AS "prevCheckpointId",
           key_id AS "keyId", signature, signed_at AS "signedAt"
      FROM audit_checkpoints
     WHERE tenant_id = ${tenantId}::uuid AND seq >= ${fromSeq} AND seq <= ${toSeq}
     ORDER BY seq ASC`;
  return rows.map(normalize);
}

export async function checkpointAt(
  tx: TransactionClient,
  tenantId: string,
  seq: bigint,
): Promise<CheckpointRow | undefined> {
  return (await checkpointsInRange(tx, tenantId, seq, seq))[0];
}

export async function latestCheckpoints(
  tx: TransactionClient,
  tenantId: string,
  limit: number,
): Promise<CheckpointRow[]> {
  const rows = await tx.$queryRaw<CheckpointRow[]>`
    SELECT id, tenant_id AS "tenantId", seq, hash, session_heads_digest AS "sessionHeadsDigest",
           session_heads_count AS "sessionHeadsCount", prev_checkpoint_id AS "prevCheckpointId",
           key_id AS "keyId", signature, signed_at AS "signedAt"
      FROM audit_checkpoints WHERE tenant_id = ${tenantId}::uuid ORDER BY seq DESC LIMIT ${limit}`;
  return rows.map(normalize);
}

/** Newest checkpoint with seq <= `seq`. */
export async function checkpointBefore(
  tx: TransactionClient,
  tenantId: string,
  seq: bigint,
): Promise<CheckpointRow | undefined> {
  const rows = await tx.$queryRaw<CheckpointRow[]>`
    SELECT id, tenant_id AS "tenantId", seq, hash, session_heads_digest AS "sessionHeadsDigest",
           session_heads_count AS "sessionHeadsCount", prev_checkpoint_id AS "prevCheckpointId",
           key_id AS "keyId", signature, signed_at AS "signedAt"
      FROM audit_checkpoints WHERE tenant_id = ${tenantId}::uuid AND seq <= ${seq}
     ORDER BY seq DESC LIMIT 1`;
  const row = rows[0];
  return row === undefined ? undefined : normalize(row);
}

export async function latestCheckpoint(
  tx: TransactionClient,
  tenantId: string,
): Promise<CheckpointRow | undefined> {
  const rows = await tx.$queryRaw<CheckpointRow[]>`
    SELECT id, tenant_id AS "tenantId", seq, hash, session_heads_digest AS "sessionHeadsDigest",
           session_heads_count AS "sessionHeadsCount", prev_checkpoint_id AS "prevCheckpointId",
           key_id AS "keyId", signature, signed_at AS "signedAt"
      FROM audit_checkpoints WHERE tenant_id = ${tenantId}::uuid ORDER BY seq DESC LIMIT 1`;
  const row = rows[0];
  return row === undefined ? undefined : normalize(row);
}
