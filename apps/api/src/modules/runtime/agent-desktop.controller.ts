import { Controller, Get, Post, Inject, HttpCode, Header } from '@nestjs/common';
import { z } from 'zod';

import { JsonValueSchema } from '@verbis/script-schema';

import { requestContext } from '../../common/context/request-context.js';
import { UuidSchema } from '../../common/dto.js';
import { ForbiddenError, NotFoundError } from '../../common/errors/domain-errors.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZParam, ZBody } from '../../common/validation/zod.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OwnTenantTransactions } from '../../infra/database/tenant-transaction.interceptor.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { AuditService } from '../audit/audit.service.js';
import { RequirePermissions } from '../authz/permissions.js';
import { OutcomeSchema } from '../campaigns/campaigns.dto.js';
import { IntegrationEngineService } from '../integrations/integration-engine.service.js';

import { CommandSchema, RuntimeViewSchema } from './domain/runtime.js';
import { RuntimeEngineService } from './runtime-engine.service.js';
import { SecureCaptureService } from './secure-capture.service.js';

const DataRecovery = CommandSchema.omit({ command: true }).extend({
  sourceId: z.string().max(128),
  mode: z.enum(['continue', 'manual']),
});

const DataCall = CommandSchema.omit({ command: true }).extend({
  sourceId: z.string().max(128),
  input: z.record(z.string(), JsonValueSchema),
});
export const AgentDesktopSchema = z.object({
  view: RuntimeViewSchema,
  document: z.unknown(),
  checksum: z.string(),
  secureCapture: z.object({ url: z.url(), origin: z.url() }).optional(),
  startedAt: z.iso.datetime(),
  interaction: z.object({
    channel: z.string(),
    status: z.string(),
    queue: z.string().nullable(),
    platform: z.string(),
    customerName: z.string().nullable(),
    context: z.record(z.string(), JsonValueSchema),
  }),
  campaign: z.object({ name: z.string(), outcomes: z.array(OutcomeSchema) }),
  writeback: z.enum(['none', 'queued', 'success']),
});
@ApiTag('agent-desktop')
@Controller('v1/sessions')
export class AgentDesktopController {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RuntimeEngineService) private readonly runtime: RuntimeEngineService,
    @Inject(IntegrationEngineService) private readonly integrations: IntegrationEngineService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SecureCaptureService) private readonly capture: SecureCaptureService,
  ) {}
  private requireOwner(userId: string) {
    const actor = requestContext.require().principal;
    if (
      actor?.type !== 'user' ||
      actor.id !== userId ||
      actor.authMethod !== 'sso' ||
      !actor.sessionId
    )
      throw new ForbiddenError();
  }
  @Get(':id/desktop')
  @RequirePermissions('read:Session')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Owner-only pinned script, trusted interaction context and disposition set',
  })
  @ApiResponse(200, 'Agent desktop', AgentDesktopSchema)
  async desktop(@ZParam('id', UuidSchema) id: string) {
    const row = await this.runtime.row(id);
    this.runtime.authorize(row);
    this.requireOwner(row.userId);
    const interaction = this.runtime.interaction(row);
    const campaign = row.interaction?.campaignId
      ? await this.db.current().campaign.findFirst({
          where: { id: row.interaction.campaignId, tenantId: row.tenantId, deletedAt: null },
        })
      : null;
    const acknowledgement =
      row.state === 'completed'
        ? await this.db.current().auditEvent.findFirst({
            where: {
              tenantId: row.tenantId,
              targetType: 'Session',
              targetId: id,
              action: 'runtime.connector.outcome',
              outcome: 'success',
            },
            select: { id: true },
          })
        : null;
    await this.audit.record(this.db.current(), {
      action: 'runtime.desktop.read',
      target: { type: 'Session', id },
      metadata: { contextRead: true },
    });
    const attached = z.record(z.string(), JsonValueSchema).safeParse(interaction);
    return {
      view: await this.runtime.viewFromRow(row),
      document: this.runtime.document(row),
      checksum: row.checksum,
      ...(this.capture.publicProfile(row.tenantId)
        ? { secureCapture: this.capture.publicProfile(row.tenantId) }
        : {}),
      startedAt: row.startedAt.toISOString(),
      interaction: {
        channel: row.interaction?.channelType ?? 'voice',
        status: row.interaction?.status ?? row.state,
        queue: row.interaction?.queue ?? null,
        platform: row.interaction?.platform ?? 'generic',
        customerName:
          [
            interaction['customerName'],
            interaction[`channel.${row.interaction?.channelType ?? 'voice'}.customerName`],
            interaction[`channel.${row.interaction?.channelType ?? 'voice'}.profileName`],
          ].find((name): name is string => typeof name === 'string' && name.trim() !== '') ?? null,
        context: attached.success ? attached.data : {},
      },
      campaign: {
        name: campaign?.name ?? '',
        outcomes: z.array(OutcomeSchema).parse(campaign?.outcomeSet ?? []),
      },
      writeback: row.state === 'completed' ? (acknowledgement ? 'success' : 'queued') : 'none',
    };
  }
  @Post(':id/desktop/telemetry')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Writer-fenced node timing and required-read acknowledgment; metadata only',
  })
  @ApiResponse(201, 'Authoritative state', RuntimeViewSchema)
  async telemetry(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(
      CommandSchema.omit({ command: true }).extend({
        metadata: z.strictObject({
          type: z.enum(['field.observed', 'text.acknowledged']),
          name: z.string().max(128),
          status: z.enum(['success', 'failure']),
          durationMs: z.number().int().min(0).max(300000),
        }),
      }),
    )
    input: {
      writeToken: string;
      tabId: string;
      expectedSequence: number;
      metadata: {
        type: 'field.observed' | 'text.acknowledged';
        name: string;
        status: 'success' | 'failure';
        durationMs: number;
      };
    },
  ) {
    const row = await this.runtime.row(id, true);
    this.requireOwner(row.userId);
    this.runtime.claim(row, input);
    await this.runtime.recordActivity(id, input.metadata);
    return this.runtime.view(id);
  }
  @Post(':id/desktop/failure')
  @HttpCode(200)
  @RequirePermissions('read:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Owner reports a sanitized client failure for support' })
  @ApiResponse(200, 'Recorded', z.object({ recorded: z.boolean() }))
  async failure(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(
      z.strictObject({
        kind: z.enum(['script', 'authorization', 'network', 'storage']),
        correlationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      }),
    )
    input: { kind: string; correlationId: string },
  ) {
    const row = await this.runtime.row(id);
    this.requireOwner(row.userId);
    await this.audit.record(this.db.current(), {
      action: 'runtime.desktop.failed',
      target: { type: 'Session', id },
      outcome: 'failure',
      metadata: input,
    });
    return { recorded: true };
  }
  @Post(':id/desktop/data-source-recovery')
  @HttpCode(200)
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Writer acknowledges an author-allowed data source fallback' })
  @ApiResponse(200, 'Authoritative state', RuntimeViewSchema)
  async recovery(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(DataRecovery)
    input: z.infer<typeof DataRecovery>,
  ) {
    const row = await this.runtime.row(id, true);
    this.requireOwner(row.userId);
    this.runtime.claim(row, input);
    const source = this.runtime
      .document(row)
      .dataSources.find((source) => source.id === input.sourceId);
    if (source?.policy.onFailure !== input.mode)
      throw new ForbiddenError('Script recovery policy does not allow this fallback');
    if (input.mode === 'manual') {
      const document = this.runtime.document(row);
      const snapshot = await this.runtime.snapshot(row);
      const mappings = Object.values(source.outputs);
      if (
        !mappings.length ||
        mappings.some((mapping) => {
          const variable = document.variables.find((variable) => variable.key === mapping.variable);
          const value = mapping.variable ? snapshot.variables[mapping.variable] : undefined;
          return (
            !variable ||
            variable.scope === 'global' ||
            variable.classification === 'pci' ||
            ['object', 'array'].includes(variable.type) ||
            value === undefined ||
            value === null ||
            value === ''
          );
        })
      )
        throw new ForbiddenError('Manual fallback requires mapped non-payment scalar values');
    }
    await this.audit.record(this.db.current(), {
      action: 'runtime.datasource.recovered',
      target: { type: 'Session', id },
      metadata: { sourceId: source.id, mode: input.mode },
    });
    return this.runtime.view(id);
  }
  @OwnTenantTransactions()
  @Post(':id/desktop/data-source')
  @HttpCode(200)
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Writer-fenced BFF data-source execution; exact script pin and server secrets',
  })
  @ApiResponse(
    200,
    'Mapped result and authoritative state',
    z.object({ value: z.unknown(), view: RuntimeViewSchema }),
  )
  async call(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(DataCall) input: z.infer<typeof DataCall>,
  ) {
    const context = requestContext.require();
    const scoped = <T>(work: () => Promise<T>) =>
      this.db.run(this.db.tenantId(), (tx) => requestContext.run({ ...context, tx }, work));
    const prepared = await scoped(async () => {
      const row = await this.runtime.row(id, true);
      this.requireOwner(row.userId);
      this.runtime.claim(row, input);
      const source = this.runtime.document(row).dataSources.find((s) => s.id === input.sourceId);
      if (!source) throw new NotFoundError('DataSource');
      const record = await this.db.current().dataSource.findFirst({
        where: {
          tenantId: row.tenantId,
          key: source.ref.replace(/^tenant-datasource:/, ''),
          version: source.version,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!record) throw new NotFoundError('Pinned DataSource');
      return this.integrations.prepareAuthorized(record.id, id, {
        input: input.input,
        environment: 'prod',
      });
    });
    // No request transaction or session row lock is held across upstream I/O.
    const result = await this.integrations.executePrepared(prepared);
    const view = await scoped(async () => {
      const row = await this.runtime.row(id, true);
      this.requireOwner(row.userId);
      this.runtime.claim(row, input);
      await this.runtime.recordActivity(id, {
        type: 'datasource.called',
        name: input.sourceId,
        status: result.error ? 'failure' : 'success',
        durationMs: Math.min(300000, Math.round(result.durationMs)),
      });
      return this.runtime.view(id);
    });
    if (result.value === undefined) throw this.integrations.failure(result.error);
    return { value: result.value, view };
  }
}
