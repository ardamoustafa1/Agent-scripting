import { Inject, Injectable } from '@nestjs/common';

import { TenantDb } from '../../infra/database/tenant-db.js';

import { AuditQueryService } from './audit-query.service.js';
import { AuditService } from './audit.service.js';
import { latestCheckpoints } from './checkpoints.js';
import {
  buildTrustCenter,
  LAUNCH_ACTIONS,
  SENSITIVE_ACCESS_ACTIONS,
  type TrustCenter,
} from './trust-center.js';

const DAY_MS = 86_400_000;

@Injectable()
export class TrustCenterService {
  constructor(
    @Inject(AuditQueryService) private readonly query: AuditQueryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  async summary(windowDays: number, now = new Date()): Promise<TrustCenter> {
    const tx = this.db.current(),
      tenantId = this.db.tenantId(),
      since = new Date(now.getTime() - windowDays * DAY_MS);
    const report = await this.query.verify({});
    const [checkpoint] = await latestCheckpoints(tx, tenantId, 1);
    const grouped = await tx.auditEvent.groupBy({
      by: ['action'],
      where: {
        tenantId,
        occurredAt: { gte: since },
        action: { in: [...LAUNCH_ACTIONS, ...SENSITIVE_ACCESS_ACTIONS] },
      },
      _count: { _all: true },
    });
    const requests = await tx.adminPrivacyRequest.groupBy({
      by: ['state'],
      where: { tenantId },
      _count: { _all: true },
    });
    const oldest = await tx.adminPrivacyRequest.findFirst({
      where: { tenantId, state: { not: 'processed' } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const requestCount = (open: boolean): number =>
      requests
        .filter((row) => (row.state === 'processed') !== open)
        .reduce((sum, row) => sum + row._count._all, 0);
    await this.audit.record(tx, {
      action: 'audit.trustCenter.viewed',
      target: { type: 'AuditEvent', id: '*' },
      metadata: { windowDays },
    });
    return buildTrustCenter({
      now,
      windowDays,
      chain: {
        valid: report.valid,
        checked: report.checked,
        headSeq: report.headSeq,
        breaks: report.breaks.length,
        truncated: report.truncated,
        signaturesVerified: report.signaturesVerified,
        checkpointsChecked: report.checkpointsChecked,
      },
      checkpoint:
        checkpoint === undefined
          ? null
          : { seq: checkpoint.seq.toString(), signedAt: checkpoint.signedAt },
      actionCounts: new Map(grouped.map((row) => [row.action, row._count._all])),
      privacy: {
        open: requestCount(true),
        processed: requestCount(false),
        oldestOpenAt: oldest?.createdAt ?? null,
      },
    });
  }
}
