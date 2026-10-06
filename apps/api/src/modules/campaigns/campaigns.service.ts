import { Inject, Injectable } from '@nestjs/common';

import { requestContext } from '../../common/context/request-context.js';
import { NotFoundError, VersionMismatchError } from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { actorRef } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';

import {
  type CampaignDto,
  type CampaignListQuery,
  type CreateCampaignInput,
  toCampaignDto,
  type UpdateCampaignInput,
} from './campaigns.dto.js';
import { type CampaignRow, CampaignsRepository } from './campaigns.repository.js';

/** Campaign use cases. Each mutation writes state + audit + outbox in the request transaction. */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(CampaignsRepository) private readonly repository: CampaignsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  async list(query: CampaignListQuery): Promise<Page<CampaignDto>> {
    const rows = await this.repository.list(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toCampaignDto, (row, field) => row[field]);
  }

  async get(id: string): Promise<CampaignDto> {
    const row = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('Campaign');
    return toCampaignDto(row);
  }

  async create(input: CreateCampaignInput): Promise<CampaignDto> {
    const tx = this.db.current();
    const created = await this.repository.create(tx, this.db.tenantId(), input, this.actor());
    await this.repository.replaceMappings(
      tx,
      this.db.tenantId(),
      created.id,
      input.externalMappings,
      this.actor(),
    );
    const row = (await this.repository.find(tx, this.db.tenantId(), created.id)) ?? created;
    const dto = toCampaignDto(row);
    await this.audit.record(tx, {
      action: 'campaign.campaign.created',
      target: { type: 'Campaign', id: row.id, name: row.name },
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.campaigns.campaign.created.v1',
      aggregateType: 'Campaign',
      aggregateId: row.id,
      payload: { campaign: dto },
    });
    return dto;
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateCampaignInput,
  ): Promise<CampaignDto> {
    const tx = this.db.current();
    const before = await this.requireVersion(id, expectedVersion);
    const row = await this.repository.update(
      tx,
      this.db.tenantId(),
      id,
      expectedVersion,
      input,
      this.actor(),
    );
    if (row === null) throw new VersionMismatchError();
    if (input.externalMappings !== undefined) {
      await this.repository.replaceMappings(
        tx,
        this.db.tenantId(),
        id,
        input.externalMappings,
        this.actor(),
      );
    }
    const fresh = (await this.repository.find(tx, this.db.tenantId(), id)) ?? row;
    const dto = toCampaignDto(fresh);
    await this.audit.record(tx, {
      action: 'campaign.campaign.updated',
      target: { type: 'Campaign', id, name: row.name },
      before: toCampaignDto(before),
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.campaigns.campaign.updated.v1',
      aggregateType: 'Campaign',
      aggregateId: id,
      payload: { campaign: dto, changed: Object.keys(input) },
    });
    return dto;
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    const tx = this.db.current();
    const before = await this.requireVersion(id, expectedVersion);
    if (
      !(await this.repository.softDelete(tx, this.db.tenantId(), id, expectedVersion, this.actor()))
    )
      throw new VersionMismatchError();
    await this.audit.record(tx, {
      action: 'campaign.campaign.deleted',
      target: { type: 'Campaign', id, name: before.name },
      before: toCampaignDto(before),
      after: null,
    });
    await this.outbox.record(tx, {
      type: 'verbis.campaigns.campaign.deleted.v1',
      aggregateType: 'Campaign',
      aggregateId: id,
      payload: { id },
    });
  }

  private async requireVersion(id: string, expectedVersion: number): Promise<CampaignRow> {
    const current = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (current === null) throw new NotFoundError('Campaign');
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    return current;
  }

  private actor(): string {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new Error('No principal');
    return actorRef(principal);
  }
}
