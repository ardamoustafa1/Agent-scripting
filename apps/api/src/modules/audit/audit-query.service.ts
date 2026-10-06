import { Inject, Injectable, Optional } from '@nestjs/common';

import { instruments } from '@verbis/observability';

import { requestContext } from '../../common/context/request-context.js';
import { ConflictError } from '../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';

import { AuditRepository, type AuditFilters } from './audit.repository.js';
import { AuditService } from './audit.service.js';
import {
  checkpointAt,
  checkpointPayload,
  checkpointsInRange,
  type CheckpointRow,
} from './checkpoints.js';
import { certificateBody, signCertificate, verifyCertificate } from './core/audit-certificate.js';
import { recomputeHash, type StoredAuditRow } from './core/audit-event.js';
import {
  ChainVerifier,
  GENESIS_ANCHOR,
  type ChainAnchor,
  type VerifyResult,
} from './core/chain-verifier.js';
import { CheckpointSigner, CheckpointVerifier } from './core/checkpoint-signer.js';
import { csvHeader, csvRow, toWireEvent } from './core/formats.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

export const CHECKPOINT_VERIFIER = Symbol('CHECKPOINT_VERIFIER');
const BATCH = 5_000;

export interface VerifyRequest {
  readonly fromSeq?: bigint;
  readonly toSeq?: bigint;
}

export interface VerifyReport extends VerifyResult {
  readonly signaturesVerified: boolean;
  readonly headSeq: string | null;
}

@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditRepository) private readonly repository: AuditRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Optional()
    @Inject(CHECKPOINT_VERIFIER)
    private readonly checkpointVerifier?: CheckpointVerifier,
  ) {}

  /** Signed offline-verifiable proof, bounded to the verified tenant range. */
  async certificate(request: VerifyRequest) {
    if (!this.env.AUDIT_CHECKPOINT_SIGNING_JWK)
      throw new ConflictError('Audit signing is not configured');
    const report = await this.verify(request);
    if (!report.valid || !report.signaturesVerified || !report.fromSeq || !report.toSeq)
      throw new ConflictError('A complete verified audit range is required');
    const signer = CheckpointSigner.fromJwk(this.env.AUDIT_CHECKPOINT_SIGNING_JWK);
    const tenantId = this.db.tenantId(),
      tx = this.db.current();
    const checkpoints = await checkpointsInRange(
      tx,
      tenantId,
      BigInt(report.fromSeq),
      BigInt(report.toSeq),
    );
    const body = certificateBody(tenantId, report, checkpoints, new Date());
    const certificate = signCertificate(body, signer.keyId, this.env.AUDIT_CHECKPOINT_SIGNING_JWK);
    if (!this.checkpointVerifier || !verifyCertificate(certificate, this.checkpointVerifier.jwks()))
      throw new ConflictError('The signing key must be present in the published audit keys');
    await this.audit.record(tx, {
      action: 'audit.certificate.created',
      target: { type: 'AuditCertificate', id: tenantId },
      metadata: { fromSeq: body.fromSeq, toSeq: body.toSeq, lastHash: body.lastHash },
    });
    return certificate;
  }

  /** Reading the audit trail is itself audited (CLAUDE.md §6). */
  async search(
    filters: AuditFilters,
    page: { limit: number; direction: 'asc' | 'desc'; after?: bigint },
  ): Promise<{ rows: StoredAuditRow[]; hasMore: boolean }> {
    const tx = this.db.current();
    const rows = await this.repository.search(tx, this.db.tenantId(), filters, {
      ...page,
      limit: page.limit + 1,
    });
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit);
    await this.audit.record(tx, {
      action: 'audit.event.listed',
      target: { type: 'AuditEvent', id: '*' },
      metadata: { filters: serializeFilters(filters), count: data.length },
    });
    return { rows: data, hasMore };
  }

  /**
   * Streams an export bounded by the chain head at request time (reproducible: same filters +
   * `snapshotSeq` give the same file). The export is audited in the request transaction BEFORE the
   * first byte is sent; rows are read in separate tenant transactions per batch.
   */
  async export(
    filters: AuditFilters,
    format: 'csv' | 'json',
  ): Promise<{ snapshotSeq: bigint; stream: AsyncGenerator<string> }> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const head = await this.repository.head(tx, tenantId);
    const snapshotSeq = head?.seq ?? 0n;
    const maxRows = this.env.AUDIT_EXPORT_MAX_ROWS;
    await this.audit.record(tx, {
      action: 'audit.export.created',
      target: { type: 'AuditEvent', id: '*' },
      metadata: {
        filters: serializeFilters(filters),
        format,
        snapshotSeq: snapshotSeq.toString(),
        maxRows,
      },
    });
    const ctx = requestContext.require();
    const run = <T>(fn: (t: TransactionClient) => Promise<T>): Promise<T> =>
      requestContext.run({ ...ctx }, () => this.db.run(tenantId, fn));
    const repository = this.repository;
    async function* generate(): AsyncGenerator<string> {
      let after = 0n;
      let sent = 0;
      if (format === 'csv') yield csvHeader();
      else yield '[';
      for (;;) {
        const remaining = maxRows - sent;
        if (remaining <= 0) break;
        const rows = await run((t) =>
          repository.search(
            t,
            tenantId,
            {
              ...filters,
              toSeq:
                filters.toSeq !== undefined && filters.toSeq < snapshotSeq
                  ? filters.toSeq
                  : snapshotSeq,
            },
            { limit: Math.min(BATCH, remaining), direction: 'asc', after },
          ),
        );
        if (rows.length === 0) break;
        let chunk = '';
        for (const row of rows) {
          chunk +=
            format === 'csv'
              ? csvRow(row)
              : `${sent === 0 ? '' : ','}${JSON.stringify(toWireEvent(row))}`;
          sent += 1;
        }
        yield chunk;
        const last = rows[rows.length - 1];
        if (last === undefined || rows.length < BATCH) break;
        after = last.seq;
      }
      if (format === 'json') yield ']';
    }
    return { snapshotSeq, stream: generate() };
  }

  /**
   * Verifies [fromSeq, toSeq] (default: everything retained up to the head). The anchor is the
   * preceding event, genesis, or — when history was archived — the signed checkpoint at fromSeq-1.
   */
  async verify(request: VerifyRequest): Promise<VerifyReport> {
    const tenantId = this.db.tenantId();
    const ctx = requestContext.require();
    const run = <T>(fn: (t: TransactionClient) => Promise<T>): Promise<T> =>
      requestContext.run({ ...ctx }, () => this.db.run(tenantId, fn));
    const { head, minSeq } = await run(async (t) => ({
      head: await this.repository.head(t, tenantId),
      minSeq: await this.repository.minSeq(t, tenantId),
    }));
    const toSeq = request.toSeq ?? head?.seq ?? 0n;
    const fromSeq = request.fromSeq ?? minSeq ?? 1n;

    const signaturesVerified = this.checkpointVerifier !== undefined;
    const signatureValid = (row: CheckpointRow): boolean =>
      this.checkpointVerifier?.verify(checkpointPayload(row), row.keyId, row.signature) ?? false;

    const { anchor, anchorBroken, anchorMissing } = await run((t) =>
      this.#anchor(t, tenantId, fromSeq, signatureValid),
    );
    const checkpoints = await run((t) => checkpointsInRange(t, tenantId, fromSeq, toSeq));
    const verifier = new ChainVerifier(
      tenantId,
      anchor,
      checkpoints.map((c) => ({
        id: c.id,
        seq: c.seq,
        hash: c.hash,
        signatureValid: signaturesVerified ? signatureValid(c) : true,
      })),
    );
    if (anchorMissing) verifier.anchorMissing(fromSeq - 1n);
    if (anchorBroken !== undefined) {
      verifier.anchorTampered(
        anchorBroken.seq,
        anchorBroken.kind,
        anchorBroken.expected,
        anchorBroken.actual,
      );
    }

    let after = fromSeq - 1n;
    let checked = 0;
    while (after < toSeq && checked < this.env.AUDIT_VERIFY_MAX_ROWS) {
      const rows = await run((t) => this.repository.range(t, tenantId, after, toSeq, BATCH));
      if (rows.length === 0) break;
      verifier.push(rows);
      checked += rows.length;
      const last = rows[rows.length - 1];
      if (last === undefined) break;
      after = last.seq;
    }
    const result = verifier.result(checked >= this.env.AUDIT_VERIFY_MAX_ROWS ? undefined : toSeq);
    const report: VerifyReport = {
      ...result,
      signaturesVerified,
      headSeq: head?.seq.toString() ?? null,
    };
    await this.audit.record(this.db.current(), {
      action: 'audit.chain.verified',
      target: { type: 'AuditChain', id: tenantId },
      outcome: report.valid ? 'success' : 'failure',
      metadata: {
        fromSeq: fromSeq.toString(),
        toSeq: toSeq.toString(),
        checked: report.checked,
        breaks: report.breaks.length,
        firstBreak: report.breaks[0] ?? null,
      },
    });
    if (!report.valid) instruments.auditFailures.add(1);
    return report;
  }

  async #anchor(
    tx: TransactionClient,
    tenantId: string,
    fromSeq: bigint,
    signatureValid: (row: CheckpointRow) => boolean,
  ): Promise<{
    anchor: ChainAnchor;
    anchorBroken?: {
      seq: bigint;
      kind: 'hash_mismatch' | 'checkpoint_mismatch';
      expected: string;
      actual: string;
    };
    anchorMissing: boolean;
  }> {
    if (fromSeq <= 1n) return { anchor: GENESIS_ANCHOR, anchorMissing: false };
    const previous = await this.repository.findBySeq(tx, tenantId, fromSeq - 1n);
    const checkpoint = await checkpointAt(tx, tenantId, fromSeq - 1n);
    if (previous !== undefined) {
      const anchor: ChainAnchor = { seq: previous.seq, hash: previous.hash, source: 'event' };
      // The anchor row's own content must be intact, and match a checkpoint if there is one.
      const recomputed = recomputeHash(previous);
      if (recomputed !== previous.hash) {
        return {
          anchor,
          anchorMissing: false,
          anchorBroken: {
            seq: previous.seq,
            kind: 'hash_mismatch',
            expected: recomputed,
            actual: previous.hash,
          },
        };
      }
      if (checkpoint !== undefined && checkpoint.hash !== previous.hash) {
        return {
          anchor,
          anchorMissing: false,
          anchorBroken: {
            seq: previous.seq,
            kind: 'checkpoint_mismatch',
            expected: checkpoint.hash,
            actual: previous.hash,
          },
        };
      }
      return { anchor, anchorMissing: false };
    }
    if (
      checkpoint !== undefined &&
      (this.checkpointVerifier === undefined || signatureValid(checkpoint))
    ) {
      return {
        anchor: { seq: checkpoint.seq, hash: checkpoint.hash, source: 'checkpoint' },
        anchorMissing: false,
      };
    }
    return { anchor: { seq: fromSeq - 1n, hash: '', source: 'checkpoint' }, anchorMissing: true };
  }
}

function serializeFilters(filters: AuditFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
  );
}
