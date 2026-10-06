import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { currentActor } from '../../../common/actor.js';
import {
  ConflictError,
  NotFoundError,
  VersionMismatchError,
} from '../../../common/errors/domain-errors.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { AuditService } from '../audit.service.js';

import { KafkaConfigSchema, SyslogConfigSchema, WebhookConfigSchema } from './sink.js';

import type { Prisma } from '../../../generated/prisma/client.js';

/** Secret references only (CLAUDE.md §1.12): `secret://<name>`; the value lives in the store. */
const SecretRef = z.string().regex(/^secret:\/\/[a-z0-9][a-z0-9._-]{0,127}$/);

export const CreateSiemDestinationSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('syslog'),
      name: z.string().min(1).max(100),
      format: z.enum(['rfc5424', 'cef', 'json']).default('rfc5424'),
      config: SyslogConfigSchema,
    }),
    z.strictObject({
      kind: z.literal('webhook'),
      name: z.string().min(1).max(100),
      format: z.literal('json').default('json'),
      config: WebhookConfigSchema,
      secretRef: SecretRef,
    }),
    z.strictObject({
      kind: z.literal('kafka'),
      name: z.string().min(1).max(100),
      format: z.enum(['json', 'cef']).default('json'),
      config: KafkaConfigSchema,
    }),
  ])
  .meta({ id: 'CreateSiemDestination' });
export type CreateSiemDestination = z.output<typeof CreateSiemDestinationSchema>;

export const UpdateSiemDestinationSchema = z
  .strictObject({ enabled: z.boolean() })
  .meta({ id: 'UpdateSiemDestination' });

export const SiemDestinationSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.string(),
    format: z.string(),
    config: z.record(z.string(), z.unknown()),
    secretRef: z.string().nullable(),
    enabled: z.boolean(),
    version: z.number().int(),
    delivery: z
      .object({
        lastSeq: z.string(),
        attempts: z.number().int(),
        lastError: z.string().nullable(),
        deliveredAt: z.string().nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'SiemDestination' });

type Row = Prisma.SiemDestinationGetPayload<{ include: { cursor: true } }>;

function toDto(row: Row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    format: row.format,
    config: row.config as Record<string, unknown>,
    secretRef: row.secretRef,
    enabled: row.enabled,
    version: row.version,
    delivery:
      row.cursor === null
        ? null
        : {
            lastSeq: row.cursor.lastSeq.toString(),
            attempts: row.cursor.attempts,
            lastError: row.cursor.lastError,
            deliveredAt: row.cursor.deliveredAt?.toISOString() ?? null,
          },
  };
}

/** SIEM destination administration; delivery itself runs in the audit worker. */
@Injectable()
export class SiemDestinationsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.db.current().siemDestination.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      include: { cursor: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(input: CreateSiemDestination) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const exists = await tx.siemDestination.findFirst({
      where: { tenantId, name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (exists !== null) throw new ConflictError('A SIEM destination with this name exists');
    const actor = currentActor();
    const id = randomUUID();
    // New destinations start at the current head: history is exported, not replayed.
    const head = await tx.auditChainHead.findUnique({ where: { tenantId }, select: { seq: true } });
    const row = await tx.siemDestination.create({
      data: {
        id,
        tenantId,
        name: input.name,
        kind: input.kind,
        format: input.format,
        config: input.config,
        secretRef: input.kind === 'webhook' ? input.secretRef : null,
        createdBy: actor,
        updatedBy: actor,
        cursor: { create: { tenantId, lastSeq: head?.seq ?? 0n } },
      },
      include: { cursor: true },
    });
    const dto = toDto(row);
    await this.audit.record(tx, {
      action: 'audit.siemDestination.created',
      target: { type: 'SiemDestination', id, name: input.name },
      after: { ...dto, delivery: undefined },
    });
    return dto;
  }

  async setEnabled(id: string, expectedVersion: number, enabled: boolean) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const before = await tx.siemDestination.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { cursor: true },
    });
    if (before === null) throw new NotFoundError('SIEM destination');
    if (before.version !== expectedVersion) throw new VersionMismatchError(before.version);
    const updated = await tx.siemDestination.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        enabled,
        updatedBy: currentActor(),
        updatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new VersionMismatchError();
    const row = await tx.siemDestination.findFirstOrThrow({
      where: { id, tenantId },
      include: { cursor: true },
    });
    await this.audit.record(tx, {
      action: enabled ? 'audit.siemDestination.enabled' : 'audit.siemDestination.disabled',
      target: { type: 'SiemDestination', id, name: row.name },
      before: { enabled: before.enabled },
      after: { enabled },
    });
    return toDto(row);
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const result = await tx.siemDestination.updateMany({
      where: { id, tenantId, version: expectedVersion, deletedAt: null },
      data: {
        deletedAt: new Date(),
        enabled: false,
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new NotFoundError('SIEM destination');
    await this.audit.record(tx, {
      action: 'audit.siemDestination.deleted',
      target: { type: 'SiemDestination', id },
      after: null,
    });
  }
}
