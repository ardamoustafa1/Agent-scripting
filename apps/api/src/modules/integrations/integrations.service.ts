import { Inject, Injectable } from '@nestjs/common';

import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import {
  type DataSourceDto,
  type DataSourceListQuery,
  type SecretListQuery,
  type SecretMetadataDto,
  toDataSourceDto,
  toSecretDto,
} from './integrations.dto.js';
import { IntegrationsRepository } from './integrations.repository.js';

/** Paginated definitions and audited secret metadata; execution lives in IntegrationEngineService. */
@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listDataSources(query: DataSourceListQuery): Promise<Page<DataSourceDto>> {
    const rows = await this.repository.listDataSources(
      this.db.current(),
      this.db.tenantId(),
      query,
    );
    return toPage(rows, query, toDataSourceDto, (row, field) => row[field]);
  }

  /** Secret metadata reads are audited (CLAUDE.md §6). */
  async listSecrets(query: SecretListQuery): Promise<Page<SecretMetadataDto>> {
    const tx = this.db.current();
    const rows = await this.repository.listSecrets(tx, this.db.tenantId(), query);
    await this.audit.record(tx, {
      action: 'integration.secret.listed',
      target: { type: 'Secret', id: '*' },
      after: { count: Math.min(rows.length, query.limit) },
    });
    return toPage(rows, query, toSecretDto, (row, field) => row[field]);
  }
}
