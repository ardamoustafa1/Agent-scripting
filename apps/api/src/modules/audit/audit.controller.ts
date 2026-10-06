import { Readable } from 'node:stream';

import { Controller, Get, HttpCode, Inject, Optional, Post, Res } from '@nestjs/common';

import { ZBody, ZQuery } from '../../common/validation/zod.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { AuthzService } from '../authz/authz.service.js';
import { Can } from '../authz/permissions.js';

import { AuditQueryService, CHECKPOINT_VERIFIER } from './audit-query.service.js';
import {
  AuditExportQuerySchema,
  AuditPageSchema,
  AuditSearchQuerySchema,
  CheckpointSchema,
  decodeAuditCursor,
  encodeAuditCursor,
  filtersOf,
  JwksSchema,
  toAuditEventDto,
  VerifyReportSchema,
  VerifyRequestSchema,
  type AuditEventDto,
  type AuditSearchQuery,
} from './audit.dto.js';
import { latestCheckpoints } from './checkpoints.js';
import { MASK_VALUE } from './core/masking.js';

import type { CheckpointVerifier } from './core/checkpoint-signer.js';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

@ApiTag('audit')
@Controller('v1')
export class AuditController {
  constructor(
    @Inject(AuditQueryService) private readonly audit: AuditQueryService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Optional() @Inject(CHECKPOINT_VERIFIER) private readonly verifier?: CheckpointVerifier,
  ) {}

  /** Actor PII (displayName, ip, userAgent) only for callers allowed to `reveal` it. */
  #mask(dto: AuditEventDto): AuditEventDto {
    const actor = { ...dto.actor };
    for (const field of ['displayName', 'ip', 'userAgent'] as const) {
      if (actor[field] !== undefined && !this.authz.can('reveal', 'Audit', field))
        actor[field] = MASK_VALUE;
    }
    return { ...dto, actor };
  }

  @ApiOperation({ summary: 'Search the audit trail: filters, full-text search, keyset by seq' })
  @ApiResponse(200, 'A page of audit events', AuditPageSchema)
  @Can('read', 'Audit')
  @Get('audit-events')
  async list(@ZQuery(AuditSearchQuerySchema) query: AuditSearchQuery) {
    const after =
      query.cursor === undefined ? undefined : decodeAuditCursor(query.sort, query.cursor);
    const direction = query.sort === '-seq' ? 'desc' : 'asc';
    const { rows, hasMore } = await this.audit.search(filtersOf(query), {
      limit: query.limit,
      direction,
      ...(after === undefined ? {} : { after }),
    });
    const last = rows[rows.length - 1];
    return {
      data: rows.map((row) => this.#mask(toAuditEventDto(row))),
      page: {
        limit: query.limit,
        nextCursor: hasMore && last !== undefined ? encodeAuditCursor(query.sort, last.seq) : null,
        sort: query.sort,
      },
    };
  }

  @ApiOperation({ summary: 'Export matching events as CSV or JSON (the export itself is audited)' })
  @ApiResponse(200, 'CSV or JSON file')
  @Can('export', 'Audit')
  @Get('audit-events/export')
  async export(
    @ZQuery(AuditExportQuerySchema) query: z.output<typeof AuditExportQuerySchema>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { format, ...search } = query;
    const { snapshotSeq, stream } = await this.audit.export(filtersOf(search), format);
    const name = `audit-${this.db.tenantId()}-${snapshotSeq.toString()}.${format}`;
    await reply
      .header(
        'content-type',
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      )
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'no-store')
      .header('x-verbis-audit-snapshot-seq', snapshotSeq.toString())
      .send(Readable.from(stream));
  }

  @ApiOperation({ summary: 'Verify chain integrity over a seq range and report broken links' })
  @ApiResponse(200, 'Verification report', VerifyReportSchema)
  @Can('read', 'Audit')
  @HttpCode(200)
  @Post('audit-events/verify')
  verify(@ZBody(VerifyRequestSchema) body: z.output<typeof VerifyRequestSchema>) {
    return this.audit.verify({
      ...(body.fromSeq === undefined ? {} : { fromSeq: body.fromSeq }),
      ...(body.toSeq === undefined ? {} : { toSeq: body.toSeq }),
    });
  }

  @ApiOperation({ summary: 'Signed checkpoints (latest 100)' })
  @ApiResponse(200, 'Checkpoints', CheckpointSchema)
  @Can('read', 'Audit')
  @Get('audit-checkpoints')
  async checkpoints() {
    const rows = await latestCheckpoints(this.db.current(), this.db.tenantId(), 100);
    return rows.map((row) => ({
      ...row,
      seq: row.seq.toString(),
      signedAt: row.signedAt.toISOString(),
    }));
  }

  @ApiOperation({ summary: 'Public Ed25519 keys (JWKS) for offline checkpoint verification' })
  @ApiResponse(200, 'JWKS', JwksSchema)
  @Can('read', 'Audit')
  @Get('audit-checkpoints/keys')
  keys() {
    return this.verifier?.jwks() ?? { keys: [] };
  }
}
