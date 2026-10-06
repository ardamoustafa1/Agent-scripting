import { Inject, Injectable } from '@nestjs/common';

import { currentActor } from '../../common/actor.js';
import { requestContext } from '../../common/context/request-context.js';
import {
  NotFoundError,
  VersionMismatchError,
  ConflictError,
} from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';

import { ipAllowed } from './ip-policy.js';
import { type TenantDto, toTenantDto, type UpdateTenantSettingsInput } from './tenancy.dto.js';
import { TenancyRepository } from './tenancy.repository.js';

import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class TenancyService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(TenancyRepository) private readonly repository: TenancyRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  async current(): Promise<TenantDto> {
    const row = await this.repository.find(this.db.current(), this.db.tenantId());
    if (row === null) throw new NotFoundError('Tenant');
    return toTenantDto(row);
  }

  async updateSettings(
    expectedVersion: number,
    input: UpdateTenantSettingsInput,
  ): Promise<TenantDto> {
    const tx = this.db.current();
    const before = await this.current();
    if (before.version !== expectedVersion) throw new VersionMismatchError(before.version);
    const settings = {
      ...before.settings,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    };
    if (!ipAllowed(settings, requestContext.require().ip))
      throw new ConflictError('New IP policy would exclude the current administrator');
    const row = await this.repository.updateSettings(
      tx,
      before.id,
      expectedVersion,
      settings as Prisma.InputJsonValue,
      currentActor(),
    );
    if (row === null) throw new VersionMismatchError();
    const after = toTenantDto(row);
    await this.audit.record(tx, {
      action: 'tenancy.tenant.updated',
      target: { type: 'Tenant', id: after.id, name: after.slug },
      before: before.settings,
      after: after.settings,
    });
    await this.outbox.record(tx, {
      type: 'verbis.tenancy.tenant.updated.v1',
      aggregateType: 'Tenant',
      aggregateId: after.id,
      payload: { changed: Object.keys(input) },
    });
    return after;
  }
}
