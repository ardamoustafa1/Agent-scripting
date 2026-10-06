import { Inject, Injectable, Logger } from '@nestjs/common';

import { requestContext, systemContext } from '../common/context/request-context.js';
import { ulid } from '../common/ids/ulid.js';
import { type ApiEnv, API_ENV } from '../env.js';
import { PrismaService, type TransactionClient } from '../infra/database/prisma.service.js';
import { TenantDb } from '../infra/database/tenant-db.js';
import { AuditRepository } from '../modules/audit/audit.repository.js';
import { AuditService } from '../modules/audit/audit.service.js';
import {
  checkpointAt,
  checkpointBefore,
  checkpointPayload,
  latestCheckpoint,
  type CheckpointRow,
} from '../modules/audit/checkpoints.js';
import { recomputeHash } from '../modules/audit/core/audit-event.js';
import {
  ChainVerifier,
  GENESIS_ANCHOR,
  type VerifyResult,
} from '../modules/audit/core/chain-verifier.js';
import {
  sessionHeadsDigest,
  type CheckpointSigner,
} from '../modules/audit/core/checkpoint-signer.js';
import { toInt } from '../modules/audit/core/scalars.js';

import { activeTenants } from './tenants.js';

export const CHECKPOINT_SIGNER = Symbol('CHECKPOINT_SIGNER');
const SYSTEM_ACTOR = { type: 'system', id: 'audit-worker' } as const;
const BATCH = 5_000;

/**
 * Signs a checkpoint per tenant when its chain (or a session chain) moved. Before signing it
 * re-verifies everything since the previous checkpoint — a signature never legitimizes tampering.
 * On a break it records `audit.chain.integrityViolation` and refuses to sign until resolved.
 */
@Injectable()
export class CheckpointJob {
  readonly #logger = new Logger(CheckpointJob.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AuditRepository) private readonly repository: AuditRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CHECKPOINT_SIGNER) private readonly signer: CheckpointSigner,
  ) {}

  async tick(): Promise<void> {
    for (const tenant of await activeTenants(this.prisma, this.env.AUDIT_DEFAULT_RETENTION_DAYS)) {
      await this.checkpointTenant(tenant.id);
    }
  }

  /** Signs the current head (or `atSeq`, used for retention boundaries). Returns the checkpoint. */
  async checkpointTenant(tenantId: string, atSeq?: bigint): Promise<CheckpointRow | undefined> {
    const ctx = systemContext(ulid(), 'audit-worker:checkpoint');
    return requestContext.run(ctx, () =>
      this.tenantDb.run(
        tenantId,
        async (tx) => {
          // One signer per tenant across replicas.
          const locked = await tx.$queryRaw<{ ok: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${`audit-checkpoint:${tenantId}`}, 0)) AS ok`;
          if (locked[0]?.ok !== true) return undefined;
          const head = await this.repository.head(tx, tenantId);
          if (head === undefined || head.seq === 0n) return undefined;
          const targetSeq = atSeq ?? head.seq;
          if (targetSeq > head.seq) return undefined;
          if (atSeq !== undefined) {
            const exact = await checkpointAt(tx, tenantId, atSeq);
            if (exact !== undefined) return exact;
          }
          // Anchor: the newest checkpoint at or before the target (boundary checkpoints may lie
          // behind the latest one).
          const last =
            atSeq === undefined
              ? await latestCheckpoint(tx, tenantId)
              : await checkpointBefore(tx, tenantId, atSeq);
          if (last !== undefined && last.seq >= targetSeq) return undefined;

          const sessions = await tx.$queryRaw<{ sessionId: string; seq: number; hash: string }[]>`
            SELECT session_id AS "sessionId", seq, hash FROM session_chain_heads
             WHERE tenant_id = ${tenantId}::uuid
               AND recorded_at > ${last?.signedAt ?? new Date(0)}::timestamptz`;
          const result = await this.#verifySince(tx, tenantId, last, targetSeq);
          if (!result.valid) {
            this.#logger.error(
              `Audit chain integrity violation for tenant ${tenantId} at seq ${result.breaks[0]?.seq ?? '?'}`,
            );
            await this.audit.recordMany(
              tx,
              [
                {
                  action: 'audit.chain.integrityViolation',
                  target: { type: 'AuditChain', id: tenantId },
                  outcome: 'failure',
                  actor: SYSTEM_ACTOR,
                  reason: result.breaks[0]?.kind ?? 'unknown',
                  metadata: {
                    breaks: result.breaks.slice(0, 10),
                    fromSeq: result.fromSeq,
                    toSeq: result.toSeq,
                  },
                },
              ],
              { tenantId },
            );
            return undefined;
          }
          const row: Omit<CheckpointRow, 'keyId' | 'signature'> = {
            id: ulid(),
            tenantId,
            seq: targetSeq,
            hash: result.lastHash,
            sessionHeadsDigest: sessionHeadsDigest(
              sessions.map((s) => ({ ...s, seq: toInt(s.seq) })),
            ),
            sessionHeadsCount: sessions.length,
            prevCheckpointId: last?.id ?? null,
            signedAt: new Date(),
          };
          const signature = this.signer.sign(checkpointPayload(row));
          await tx.$executeRaw`
            INSERT INTO audit_checkpoints (id, tenant_id, seq, hash, session_heads_digest, session_heads_count,
                                           prev_checkpoint_id, key_id, signature, signed_at)
            VALUES (${row.id}, ${tenantId}::uuid, ${row.seq}, ${row.hash}, ${row.sessionHeadsDigest},
                    ${row.sessionHeadsCount}, ${row.prevCheckpointId}, ${this.signer.keyId}, ${signature},
                    ${row.signedAt}::timestamptz)`;
          return { ...row, keyId: this.signer.keyId, signature };
        },
        { timeoutMs: 120_000 },
      ),
    );
  }

  /** Incremental verification from the previous checkpoint (or genesis) up to `toSeq`. */
  async #verifySince(
    tx: TransactionClient,
    tenantId: string,
    last: CheckpointRow | undefined,
    toSeq: bigint,
  ): Promise<VerifyResult> {
    if (
      last !== undefined &&
      !this.signer.verify(checkpointPayload(last), last.keyId, last.signature)
    ) {
      const verifier = new ChainVerifier(tenantId, GENESIS_ANCHOR);
      verifier.anchorTampered(
        last.seq,
        'checkpoint_mismatch',
        'valid signature',
        'invalid signature',
      );
      return verifier.result();
    }
    if (last !== undefined) {
      // Already-signed history must still match its checkpoint (catches a rewritten past).
      const signedRow = await this.repository.findBySeq(tx, tenantId, last.seq);
      if (
        signedRow !== undefined &&
        (signedRow.hash !== last.hash || recomputeHash(signedRow) !== signedRow.hash)
      ) {
        const verifier = new ChainVerifier(tenantId, GENESIS_ANCHOR);
        verifier.anchorTampered(last.seq, 'checkpoint_mismatch', last.hash, signedRow.hash);
        return verifier.result();
      }
    }
    const anchor =
      last === undefined
        ? GENESIS_ANCHOR
        : { seq: last.seq, hash: last.hash, source: 'checkpoint' as const };
    const verifier = new ChainVerifier(tenantId, anchor);
    let after = anchor.seq;
    while (after < toSeq) {
      const rows = await this.repository.range(tx, tenantId, after, toSeq, BATCH);
      if (rows.length === 0) break;
      verifier.push(rows);
      const lastRow = rows[rows.length - 1];
      if (lastRow === undefined) break;
      after = lastRow.seq;
    }
    return verifier.result(toSeq);
  }
}
