import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import {
  type IdentityProviderDto,
  type GroupDto,
  type GroupListQuery,
  type IdpListQuery,
  type RoleDto,
  type RoleListQuery,
  toIdpDto,
  toGroupDto,
  toRoleDto,
  toUserDto,
  type UserDto,
  type UserListQuery,
} from './identity.dto.js';
import { IdentityRepository } from './identity.repository.js';

/** Users and IdPs are provisioned through SSO/SCIM (steps 7–9); this module reads them. */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(IdentityRepository) private readonly repository: IdentityRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** User records carry PII: reads are audited (CLAUDE.md §6). */
  async listUsers(query: UserListQuery): Promise<Page<UserDto>> {
    const tx = this.db.current();
    const rows = await this.repository.listUsers(tx, this.db.tenantId(), query);
    await this.audit.record(tx, {
      action: 'identity.user.listed',
      target: { type: 'User', id: '*' },
      // The search term may be a name or e-mail fragment (PII): record only that one was used.
      after: {
        filters: { ...query.filters, q: undefined, searched: query.filters.q !== undefined },
        count: Math.min(rows.length, query.limit),
      },
    });
    return toPage(rows, query, toUserDto, (row, field) => row[field]);
  }

  async getUser(id: string): Promise<UserDto> {
    const tx = this.db.current();
    const row = await this.repository.findUser(tx, this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('User');
    await this.audit.record(tx, { action: 'identity.user.viewed', target: { type: 'User', id } });
    return toUserDto(row);
  }

  async listRoles(query: RoleListQuery): Promise<Page<RoleDto>> {
    const rows = await this.repository.listRoles(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toRoleDto, (row, field) => row[field]);
  }

  async listGroups(query: GroupListQuery): Promise<Page<GroupDto>> {
    const rows = await this.repository.listGroups(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toGroupDto, (row, field) => row[field]);
  }

  async listIdps(query: IdpListQuery): Promise<Page<IdentityProviderDto>> {
    const rows = await this.repository.listIdps(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toIdpDto, (row, field) => row[field]);
  }
}
