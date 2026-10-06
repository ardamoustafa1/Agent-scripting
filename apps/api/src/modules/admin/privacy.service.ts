import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AdminPrivacyInputSchema } from '@verbis/shared-types';

import { currentActor } from '../../common/actor.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import {
  ConflictError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AnalyticsStore } from '../analytics/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { RuntimeCipher } from '../runtime/runtime-cipher.js';
import { RuntimeStateStore } from '../runtime/runtime-state.store.js';

interface PrivacyRow {
  id: string;
  kind: 'search' | 'export' | 'anonymize';
  state: 'pending' | 'completed' | 'blocked';
  subject_sealed: string;
  matched_ids: unknown;
  created_at: Date;
  version: number;
}
const view = (row: PrivacyRow) => ({
  id: row.id,
  kind: row.kind,
  state: row.state,
  createdAt: row.created_at.toISOString(),
  count: z.array(z.string()).parse(row.matched_ids).length,
  version: row.version,
});
export function subjectMatches(value: unknown, subject: string) {
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) return false;
  const attached = z.record(z.string(), z.unknown()).safeParse(record.data['attachedData']);
  return ['customerId', 'ani'].some(
    (key) => record.data[key] === subject || (attached.success && attached.data[key] === subject),
  );
}
@Injectable()
export class AdminPrivacyService {
  constructor(
    @Inject(AnalyticsStore) private readonly analytics: AnalyticsStore,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RuntimeCipher) private readonly cipher: RuntimeCipher,
    @Inject(RuntimeStateStore) private readonly state: RuntimeStateStore,
  ) {}
  async list() {
    const tenantId = this.db.tenantId();
    const rows = await this.db.current().$queryRaw<
      PrivacyRow[]
    >`SELECT * FROM admin_privacy_requests WHERE tenant_id=${tenantId}::uuid ORDER BY created_at DESC LIMIT 100`;
    return rows.map(view);
  }
  async create(input: z.infer<typeof AdminPrivacyInputSchema>) {
    const id = uuidv7(),
      tenantId = this.db.tenantId(),
      tx = this.db.current(),
      actor = currentActor();
    const sealed = this.cipher.seal(input.subject, `runtime:privacy:${tenantId}:${id}`),
      reason = this.cipher.seal(input.reason, `runtime:privacyReason:${tenantId}:${id}`);
    const rows = await tx.$queryRaw<
      PrivacyRow[]
    >`INSERT INTO admin_privacy_requests(id,tenant_id,kind,subject_sealed,reason,created_by) VALUES(${id}::uuid,${tenantId}::uuid,${input.kind},${sealed},${reason},${actor}) RETURNING *`;
    await this.audit.record(tx, {
      action: 'admin.privacy.requested',
      target: { type: 'PrivacyRequest', id },
      metadata: { kind: input.kind, identityVerified: true },
    });
    const row = rows[0];
    if (!row) throw new ConflictError('Request failed');
    return view(row);
  }
  private async row(id: string, version?: number) {
    const tenantId = this.db.tenantId();
    const rows = await this.db.current().$queryRaw<
      PrivacyRow[]
    >`SELECT * FROM admin_privacy_requests WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new NotFoundError('PrivacyRequest');
    if (version !== undefined && row.version !== version) throw new VersionMismatchError();
    return row;
  }
  async process(id: string, version: number) {
    const row = await this.row(id, version),
      tx = this.db.current(),
      tenantId = this.db.tenantId();
    if (row.state !== 'pending') throw new ConflictError('Request already processed');
    await tx.$queryRaw`SELECT id FROM tenants WHERE id=${tenantId}::uuid FOR UPDATE`;
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId } });
    const held = z
      .object({ audit: z.object({ legalHold: z.boolean().optional() }).optional() })
      .safeParse(tenant?.settings);
    if (row.kind === 'anonymize' && (!held.success || held.data.audit?.legalHold))
      throw new ConflictError('Legal hold prohibits anonymization');
    const subject = this.cipher.openString(row.subject_sealed, `runtime:privacy:${tenantId}:${id}`);
    const candidates = await tx.interaction.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { id: 'asc' },
      take: 1001,
    });
    if (candidates.length > 1000)
      throw new ConflictError(
        'Subject search exceeds synchronous limit; use an approved offline privacy workflow',
      );
    const matches = candidates.filter((item) => {
      const sealed = z.object({ sealed: z.string() }).safeParse(item.attributes);
      if (!sealed.success) return false;
      const payload: unknown = JSON.parse(
        this.cipher.openString(sealed.data.sealed, `runtime:interaction:${tenantId}:${item.id}`),
      );
      return subjectMatches(payload, subject);
    });
    const ids = matches.map((item) => item.id);
    if (row.kind === 'anonymize') {
      // Serialize with platform normalization and reject live sessions; immutable audit chains are untouched.
      for (const interaction of matches)
        await tx.$queryRaw`SELECT id FROM interactions WHERE id=${interaction.id}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
      const locked = await tx.interaction.findMany({ where: { tenantId, id: { in: ids } } });
      if (
        locked.length !== matches.length ||
        locked.some(
          (item) => matches.find((original) => original.id === item.id)?.version !== item.version,
        )
      )
        throw new VersionMismatchError();
      if (
        matches.some((item) => !['ended', 'wrapup'].includes(item.status)) ||
        (await tx.session.count({
          where: {
            tenantId,
            interactionId: { in: ids },
            state: { in: ['launching', 'active', 'paused', 'wrapup'] },
          },
        }))
      )
        throw new ConflictError('Close active interactions before anonymization');
      for (const interaction of matches)
        await tx.interaction.updateMany({
          where: { id: interaction.id, tenantId, version: interaction.version },
          data: {
            attributes: {
              sealed: this.cipher.seal('{}', `runtime:interaction:${tenantId}:${interaction.id}`),
            },
            participants: [],
            version: { increment: 1 },
            updatedBy: currentActor(),
          },
        });
      const sessions = await tx.session.findMany({
        where: { tenantId, interactionId: { in: ids } },
        select: { id: true },
      });
      await tx.session.updateMany({
        where: { tenantId, id: { in: sessions.map((session) => session.id) } },
        data: {
          variables: {},
          decisionTrace: Prisma.DbNull,
          version: { increment: 1 },
          updatedBy: currentActor(),
        },
      });
      await this.analytics.eraseSessions(
        tx,
        tenantId,
        sessions.map((session) => session.id),
      );
      for (const session of sessions) await this.state.evict(tenantId, session.id);
      await tx.outcome.updateMany({
        where: { tenantId, sessionId: { in: sessions.map((session) => session.id) } },
        data: {
          notes: null,
          sealedData: null,
          callbackAt: null,
          version: { increment: 1 },
          updatedBy: currentActor(),
        },
      });
    }
    const matched = JSON.stringify(ids);
    const updated = await tx.$queryRaw<
      PrivacyRow[]
    >`UPDATE admin_privacy_requests SET state='completed',matched_ids=${matched}::jsonb,version=version+1 WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid AND version=${version} RETURNING *`;
    await this.audit.record(tx, {
      action: 'admin.privacy.processed',
      target: { type: 'PrivacyRequest', id },
      metadata: { kind: row.kind, count: ids.length, immutableAuditPreserved: true },
    });
    const result = updated[0];
    if (!result) throw new VersionMismatchError();
    return view(result);
  }
  async export(id: string) {
    const row = await this.row(id);
    if (row.kind !== 'export' || row.state !== 'completed')
      throw new ConflictError('Completed export request required');
    const ids = z.array(z.uuid()).parse(row.matched_ids),
      tenantId = this.db.tenantId();
    const interactions = await this.db.current().interaction.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, channelType: true, startedAt: true, endedAt: true, attributes: true },
    });
    const records = interactions.map((item) => {
      const sealed = z.object({ sealed: z.string() }).safeParse(item.attributes);
      const data = sealed.success
        ? z
            .record(z.string(), z.unknown())
            .parse(
              JSON.parse(
                this.cipher.openString(
                  sealed.data.sealed,
                  `runtime:interaction:${tenantId}:${item.id}`,
                ),
              ),
            )
        : {};
      return {
        id: item.id,
        channel: item.channelType,
        startedAt: item.startedAt.toISOString(),
        endedAt: item.endedAt?.toISOString() ?? null,
        customerId: typeof data['customerId'] === 'string' ? data['customerId'] : null,
        ani: typeof data['ani'] === 'string' ? data['ani'] : null,
      };
    });
    await this.audit.record(this.db.current(), {
      action: 'admin.privacy.exported',
      target: { type: 'PrivacyRequest', id },
      metadata: { count: records.length },
    });
    return { requestId: id, records };
  }
}
