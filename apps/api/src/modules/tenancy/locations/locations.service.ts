import { Inject, Injectable } from '@nestjs/common';

import { currentActor } from '../../../common/actor.js';
import {
  ConflictError,
  NotFoundError,
  VersionMismatchError,
} from '../../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../../common/pagination/pagination.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { AuditService } from '../../audit/audit.service.js';

import {
  toLocationDto,
  type CreateLocationInput,
  type LocationDto,
  type LocationListQuery,
  type LocationRow,
  type UpdateLocationInput,
} from './locations.dto.js';
import { LocationsRepository } from './locations.repository.js';

/** Tenant location (site) catalog: the named choices role scopes (`siteIds`) are picked from. */
@Injectable()
export class LocationsService {
  private readonly repository = new LocationsRepository();

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  async list(query: LocationListQuery): Promise<Page<LocationDto>> {
    const rows = await this.repository.list(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toLocationDto, (row, field) => row[field]);
  }

  async create(input: CreateLocationInput): Promise<LocationDto> {
    const tx = this.db.current();
    if ((await this.repository.findByCode(tx, this.db.tenantId(), input.code)) !== null)
      throw new ConflictError('A location with this code already exists');
    const row = await this.repository.create(tx, this.db.tenantId(), input, currentActor());
    const dto = toLocationDto(row);
    await this.audit.record(tx, {
      action: 'tenancy.location.created',
      target: { type: 'Location', id: row.id, name: row.code },
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.tenancy.location.created.v1',
      aggregateType: 'Location',
      aggregateId: row.id,
      payload: { location: dto },
    });
    return dto;
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateLocationInput,
  ): Promise<LocationDto> {
    const tx = this.db.current();
    const before = await this.requireVersion(id, expectedVersion);
    const row = await this.repository.rename(
      tx,
      this.db.tenantId(),
      id,
      expectedVersion,
      input.name,
      currentActor(),
    );
    if (row === null) throw new VersionMismatchError();
    const dto = toLocationDto(row);
    await this.audit.record(tx, {
      action: 'tenancy.location.updated',
      target: { type: 'Location', id, name: row.code },
      before: toLocationDto(before),
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.tenancy.location.updated.v1',
      aggregateType: 'Location',
      aggregateId: id,
      payload: { location: dto },
    });
    return dto;
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    const tx = this.db.current();
    const before = await this.requireVersion(id, expectedVersion);
    if (
      !(await this.repository.softDelete(
        tx,
        this.db.tenantId(),
        id,
        expectedVersion,
        currentActor(),
      ))
    )
      throw new VersionMismatchError();
    await this.audit.record(tx, {
      action: 'tenancy.location.deleted',
      target: { type: 'Location', id, name: before.code },
      before: toLocationDto(before),
      after: null,
    });
    await this.outbox.record(tx, {
      type: 'verbis.tenancy.location.deleted.v1',
      aggregateType: 'Location',
      aggregateId: id,
      payload: { id },
    });
  }

  private async requireVersion(id: string, expectedVersion: number): Promise<LocationRow> {
    const current = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (current === null) throw new NotFoundError('Location');
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    return current;
  }
}
