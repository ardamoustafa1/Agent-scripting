import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/templates';

import { currentActor } from '../../common/actor.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import { NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { encodeDocument } from '../scripts/document-storage.js';

import type { Prisma } from '../../generated/prisma/client.js';

export const OnboardingInputSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });
export const OnboardingResultSchema = z.object({
  campaignId: z.uuid(),
  scriptId: z.uuid(),
  versionId: z.uuid(),
  connectorId: z.uuid(),
  assignmentId: z.uuid(),
});

/** One durable onboarding bundle per tenant. All resources stay draft/disabled for normal review. */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  async bootstrap(input: z.infer<typeof OnboardingInputSchema>) {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundError('Tenant');
    const settings = z.record(z.string(), z.unknown()).parse(tenant.settings);
    const previous = OnboardingResultSchema.safeParse(settings['onboarding']);
    if (previous.success) return { ...previous.data, created: false };
    const ids = {
      campaignId: uuidv7(),
      scriptId: uuidv7(),
      versionId: uuidv7(),
      connectorId: uuidv7(),
      assignmentId: uuidv7(),
    };
    const actor = currentActor(),
      meta = { tenantId, createdBy: actor, updatedBy: actor };
    await tx.campaign.create({
      data: {
        ...meta,
        id: ids.campaignId,
        name: input.name,
        channels: ['voice', 'chat', 'email'],
        queues: [],
        status: 'draft',
      },
    });
    await tx.script.create({
      data: { ...meta, id: ids.scriptId, name: input.name, tags: ['onboarding'], status: 'draft' },
    });
    const document = ScriptDocumentSchema.parse(minimalScript());
    document.id = ids.scriptId;
    document.meta.name = input.name;
    const stored = await encodeDocument(document, 256_000);
    await tx.scriptVersion.create({
      data: {
        ...meta,
        id: ids.versionId,
        scriptId: ids.scriptId,
        number: 1,
        state: 'draft',
        schemaVersion: document.schemaVersion,
        document: stored.document as unknown as Prisma.InputJsonValue,
        documentEncoding: stored.encoding,
        documentSize: stored.size,
        checksum: stored.checksum,
      },
    });
    await tx.connector.create({
      data: {
        ...meta,
        id: ids.connectorId,
        adapterType: 'generic',
        platform: 'generic',
        config: { kind: 'simulator' },
        secretRefs: [],
        status: 'disabled',
      },
    });
    await tx.assignment.create({
      data: {
        ...meta,
        id: ids.assignmentId,
        scriptId: ids.scriptId,
        campaignId: ids.campaignId,
        versionPolicy: 'latestPublished',
      },
    });
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        settings: { ...settings, onboarding: ids },
        version: { increment: 1 },
        updatedBy: actor,
      },
    });
    for (const [type, id, action] of [
      ['Campaign', ids.campaignId, 'campaign.campaign.created'],
      ['Script', ids.scriptId, 'script.script.created'],
      ['ScriptVersion', ids.versionId, 'script.version.created'],
      ['Connector', ids.connectorId, 'connector.connector.created'],
      ['Assignment', ids.assignmentId, 'assignment.assignment.created'],
      ['Tenant', tenantId, 'tenancy.tenant.onboarded'],
    ] as const)
      await this.audit.record(tx, { action, target: { type, id }, metadata: { onboarding: true } });
    await this.outbox.record(tx, {
      type: 'verbis.tenancy.tenant.onboarded.v1',
      aggregateType: 'Tenant',
      aggregateId: tenantId,
      payload: ids,
    });
    return { ...ids, created: true };
  }
}
