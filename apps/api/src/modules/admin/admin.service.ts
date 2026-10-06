import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import { AdminRepository } from './admin.repository.js';

import type { OutboxStatusDto } from './admin.dto.js';

@Injectable()
export class AdminService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AdminRepository) private readonly repository: AdminRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async outboxStatus(): Promise<OutboxStatusDto> {
    const { groups, oldest, dead } = await this.repository.outboxCounts(
      this.db.current(),
      this.db.tenantId(),
    );
    const count = (status: string) =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    return {
      pending: count('pending'),
      published: count('published'),
      dead: count('dead'),
      oldestPendingAt: oldest === null ? null : oldest.toISOString(),
      deadEvents: dead,
    };
  }

  /** Puts a dead-lettered event back in the queue (attempts reset). */
  async requeue(id: string): Promise<{ requeued: boolean }> {
    const tx = this.db.current();
    if (!(await this.repository.requeue(tx, id))) throw new NotFoundError('Dead outbox event');
    await this.audit.record(tx, {
      action: 'admin.outbox.requeued',
      target: { type: 'OutboxEvent', id },
    });
    return { requeued: true };
  }
}
