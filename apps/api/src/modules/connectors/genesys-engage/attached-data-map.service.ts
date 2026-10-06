import { Inject, Injectable } from '@nestjs/common';

import { type AttachedDataMapping, AttachedDataMapSchema } from '@verbis/sdk-connector';

import { requestContext } from '../../../common/context/request-context.js';
import { NotFoundError, VersionMismatchError } from '../../../common/errors/domain-errors.js';
import { actorRef } from '../../../common/security/principal.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { AuditService } from '../../audit/audit.service.js';

export interface AttachedDataMapDto {
  readonly connectorId: string;
  readonly version: number;
  readonly attachedData: AttachedDataMapping[];
}

/**
 * Admin-editable part of a Genesys Engage connector's config. The hub re-reads configs on its
 * refresh tick, so a change applies to new interactions within `HUB_CONFIG_REFRESH_SECONDS`.
 */
@Injectable()
export class AttachedDataMapService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(connectorId: string): Promise<AttachedDataMapDto> {
    const row = await this.#row(connectorId);
    const parsed = AttachedDataMapSchema.safeParse(
      (row.config as { attachedData?: unknown } | null)?.attachedData ?? [],
    );
    return { connectorId, version: row.version, attachedData: parsed.success ? parsed.data : [] };
  }

  async replace(
    connectorId: string,
    expected: number,
    attachedData: AttachedDataMapping[],
  ): Promise<AttachedDataMapDto> {
    const tx = this.db.current();
    const row = await this.#row(connectorId);
    if (row.version !== expected) throw new VersionMismatchError();
    const config = (row.config ?? {}) as Record<string, unknown>;
    const before = config['attachedData'] ?? [];
    const principal = requestContext.require().principal;
    const updated = await tx.connector.updateMany({
      where: { id: connectorId, tenantId: this.db.tenantId(), version: expected, deletedAt: null },
      data: {
        config: { ...config, attachedData } as never,
        version: { increment: 1 },
        updatedBy: principal === undefined ? 'system' : actorRef(principal),
      },
    });
    if (updated.count !== 1) throw new VersionMismatchError();
    await this.audit.record(tx, {
      action: 'connector.attachedDataMap.updated',
      target: { type: 'Connector', id: connectorId },
      before: { attachedData: before },
      after: { attachedData },
      diffMode: 'patch',
    });
    return { connectorId, version: expected + 1, attachedData };
  }

  async #row(connectorId: string) {
    const row = await this.db.current().connector.findFirst({
      where: {
        id: connectorId,
        tenantId: this.db.tenantId(),
        deletedAt: null,
        adapterType: 'genesys_engage',
      },
      select: { config: true, version: true },
    });
    if (row === null) throw new NotFoundError('Connector');
    return row;
  }
}
