import { Inject, Injectable } from '@nestjs/common';

import { asSubject } from '@verbis/authz';

import { NotFoundError } from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuthzService } from '../authz/authz.service.js';

import {
  type ScreenDetailDto,
  type ScreenDto,
  type ScreenListQuery,
  toScreenDetailDto,
  toScreenDto,
} from './screens.dto.js';
import { ScreensRepository } from './screens.repository.js';

@Injectable()
export class ScreensService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ScreensRepository) private readonly repository: ScreensRepository,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async list(scriptVersionId: string, query: ScreenListQuery): Promise<Page<ScreenDto>> {
    const tx = this.db.current();
    await this.authorizeRead(scriptVersionId);
    const rows = await this.repository.list(tx, this.db.tenantId(), scriptVersionId, query);
    return toPage(rows, query, toScreenDto, (row, field) => row[field]);
  }

  private async authorizeRead(scriptVersionId: string, id?: string): Promise<void> {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const version = await tx.scriptVersion.findFirst({
      where: { id: scriptVersionId, tenantId, deletedAt: null, script: { deletedAt: null } },
      select: { scriptId: true },
    });
    if (!version) throw new NotFoundError('Script version');
    const assignments = await tx.assignment.findMany({
      where: { tenantId, scriptId: version.scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    this.authz.authorize(
      'read',
      asSubject('Screen', {
        id: id ?? scriptVersionId,
        scriptVersionId,
        campaignIds: assignments.map((assignment) => assignment.campaignId),
      }),
    );
  }

  async get(id: string): Promise<ScreenDetailDto> {
    const row = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('Screen');
    await this.authorizeRead(row.scriptVersionId, id);
    return toScreenDetailDto(row);
  }
}
