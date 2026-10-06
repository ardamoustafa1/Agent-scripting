import { Inject, Injectable } from '@nestjs/common';

import { asSubject } from '@verbis/authz';

import { NotFoundError } from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';

import { RuntimeEngineService } from './runtime-engine.service.js';
import {
  type SessionDto,
  type SessionEventDto,
  type SessionEventListQuery,
  type SessionListQuery,
  toSessionDto,
  toSessionEventDto,
} from './runtime.dto.js';
import { RuntimeRepository, type SessionRow } from './runtime.repository.js';

@Injectable()
export class RuntimeService {
  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RuntimeRepository) private readonly repository: RuntimeRepository,
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listSessions(query: SessionListQuery, liveOnly = false): Promise<Page<SessionDto>> {
    const visible: SessionRow[] = [];
    let scan: SessionListQuery = { ...query, limit: 100 };
    // Scan keyset batches before paginating; filtering one page would hide later authorized rows.
    while (visible.length <= query.limit) {
      const rows = await this.repository.listSessions(
        this.db.current(),
        this.db.tenantId(),
        scan,
        liveOnly,
      );
      for (const row of rows) {
        if (
          this.authz.can(
            'read',
            asSubject('Session', { agentId: row.userId, teamId: row.teamId ?? '__unassigned__' }),
          )
        )
          visible.push(row);
        if (visible.length > query.limit) break;
      }
      const last = rows.at(-1);
      if (rows.length < 101 || last === undefined || visible.length > query.limit) break;
      scan = {
        ...scan,
        cursor: {
          s: `${query.sort.direction === 'desc' ? '-' : ''}${query.sort.field}`,
          v: last[query.sort.field].toISOString(),
          id: last.id,
        },
      };
    }
    let disclosures = 0;
    const page = toPage(
      visible,
      query,
      (row) => {
        const subject = asSubject('Session', {
          agentId: row.userId,
          teamId: row.teamId ?? '__unassigned__',
        });
        const interaction = row.interaction;
        const reveal = this.authz.can('reveal', subject, 'customer');
        const attributes =
          interaction && reveal
            ? this.engine.interactionLabelContext(this.db.tenantId(), interaction)
            : {};
        const channel = interaction?.channelType ?? 'voice';
        const customerName =
          [
            attributes['customerName'],
            attributes[`channel.${channel}.customerName`],
            attributes[`channel.${channel}.profileName`],
          ].find((name): name is string => typeof name === 'string' && name.trim() !== '') ?? null;
        if (customerName) disclosures++;
        return { ...toSessionDto(row), desktopLabel: { channel, customerName } };
      },
      (row, field) => row[field],
    );
    if (disclosures)
      await this.audit.record(this.db.current(), {
        action: 'runtime.sessions.labels.read',
        target: { type: 'Session', id: '*' },
        metadata: { count: disclosures },
      });
    return page;
  }

  async getSession(id: string): Promise<SessionDto> {
    const row = await this.repository.findSession(this.db.current(), this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('Session');
    this.authz.authorize(
      'read',
      asSubject('Session', { agentId: row.userId, teamId: row.teamId ?? '__unassigned__' }),
    );
    return toSessionDto(row);
  }

  async listEvents(
    sessionId: string,
    query: SessionEventListQuery,
  ): Promise<Page<SessionEventDto>> {
    await this.getSession(sessionId);
    const rows = await this.repository.listEvents(
      this.db.current(),
      this.db.tenantId(),
      sessionId,
      query,
    );
    return toPage(rows, query, toSessionEventDto, (row) => row.seq);
  }
}
