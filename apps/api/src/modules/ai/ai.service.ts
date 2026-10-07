import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import { walkNodes, ScriptDocumentSchema, validateScriptDocument } from '@verbis/script-schema';
import { AiConfigSchema, type AiConfig, type AiRequest } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import {
  DomainError,
  ForbiddenError,
  ConflictError,
  VersionMismatchError,
  ValidationError,
} from '../../common/errors/domain-errors.js';
import { actorRef } from '../../common/security/principal.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { INTEGRATION_VAULT } from '../integrations/integration-engine.service.js';
import { RuntimeEngineService } from '../runtime/runtime-engine.service.js';
import { ScriptsService } from '../scripts/scripts.service.js';

import { extractText } from './import.js';
import { EndpointSchema, type LlmProvider } from './providers.js';
import { maskPatterns, systemPrompt, validateOutput } from './safety.js';
import { postJson } from './transport.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EnvelopeVault } from '../integrations/engine/vault.js';

export const AI_PROVIDER = Symbol('AI_PROVIDER');
export function cost(input: number, output: number, config: AiConfig): number {
  return Math.ceil(
    (input * config.inputMicroUsdPerMillion + output * config.outputMicroUsdPerMillion) / 1_000_000,
  );
}
const RedactorSchema = z.strictObject({
  text: z.string().max(240000),
  count: z.number().int().nonnegative(),
  complete: z.literal(true),
});
@Injectable()
export class AiService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(INTEGRATION_VAULT) private readonly vault: EnvelopeVault,
    @Inject(RuntimeEngineService) private readonly runtime: RuntimeEngineService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
    @Inject(AI_PROVIDER) private readonly provider: LlmProvider,
  ) {}
  private endpoints() {
    return z.array(EndpointSchema).parse(JSON.parse(this.env.AI_ENDPOINTS_JSON));
  }
  private async tenant(tx = this.db.current()) {
    const tenant = await tx.tenant.findFirstOrThrow({
      where: { id: this.db.tenantId(), deletedAt: null },
    });
    const settings = z.record(z.string(), z.unknown()).parse(tenant.settings);
    return { tenant, settings, config: AiConfigSchema.parse(settings['ai'] ?? {}) };
  }
  async status() {
    const { config } = await this.tenant();
    return {
      enabled: this.env.AI_ENABLED && config.enabled,
      agentEnabled: this.env.AI_ENABLED && config.enabled && config.agentEnabled,
    };
  }
  async settings() {
    this.authz.authorize('manage', asSubject('Tenant', { id: this.db.tenantId() }));
    const { tenant, config } = await this.tenant();
    return {
      version: tenant.version,
      config,
      available: this.env.AI_ENABLED,
      endpoints: this.endpoints().map(({ id, provider, residency, models }) => ({
        id,
        provider,
        residency,
        models,
      })),
    };
  }
  async save(version: number, config: AiConfig) {
    this.authz.authorize('manage', asSubject('Tenant', { id: this.db.tenantId() }));
    const { tenant } = await this.tenant();
    const principal = requestContext.require().principal;
    if (!principal) throw new ForbiddenError();
    if (config.enabled) {
      const endpoint = this.endpoints().find((e) => e.id === config.endpointId);
      if (
        !this.env.AI_ENABLED ||
        !endpoint ||
        !endpoint.models.includes(config.model) ||
        !config.secretRef ||
        !this.env.AI_REDACTOR_JSON
      )
        throw new DomainError('VERBIS_AI_UNAVAILABLE');
      const secret = await this.db.current().secret.findFirst({
        where: { tenantId: tenant.id, id: config.secretRef, deletedAt: null },
        select: { id: true },
      });
      if (!secret)
        throw new ValidationError([
          { path: '/config/secretRef', message: 'Unknown secret reference' },
        ]);
      this.authz.authorize('manage', asSubject('Secret', { id: secret.id }));
    }
    const changed = await this.db.current()
      .$executeRaw`UPDATE tenants SET settings=jsonb_set(settings,'{ai}',${JSON.stringify(config)}::jsonb),version=version+1,updated_at=now(),updated_by=${actorRef(principal)} WHERE id=${tenant.id}::uuid AND version=${version}`;
    if (!changed) throw new VersionMismatchError();
    await this.audit.record(this.db.current(), {
      action: 'ai.configuration.changed',
      target: { type: 'Tenant', id: tenant.id },
      metadata: {
        enabled: config.enabled,
        agentEnabled: config.agentEnabled,
        endpointId: config.endpointId,
        model: config.model,
        secretRef: config.secretRef,
      },
    });
    await this.outbox.record(this.db.current(), {
      type: 'verbis.admin.ai.configured.v1',
      aggregateType: 'Tenant',
      aggregateId: tenant.id,
      payload: { enabled: config.enabled },
    });
    return this.settings();
  }
  async reconcile() {
    this.authz.authorize('manage', asSubject('Tenant', { id: this.db.tenantId() }));
    const tx = this.db.current();
    const rows = await tx.$queryRaw<
      { id: string; month: Date }[]
    >`UPDATE ai_calls SET state='unknown',finished_at=now() WHERE tenant_id=${this.db.tenantId()}::uuid AND state='reserved' AND created_at<now()-interval '5 minutes' RETURNING id,month`;
    for (const row of rows) {
      await tx.$executeRaw`UPDATE ai_usage SET pending=GREATEST(0,pending-1) WHERE tenant_id=${this.db.tenantId()}::uuid AND month=${row.month}::date`;
      await this.audit.record(tx, {
        action: 'ai.call.reconciled',
        target: { type: 'AiCall', id: row.id },
        reason: 'STALE_FULL_RESERVATION_RETAINED',
      });
    }
    return { reconciled: rows.length };
  }
  async usage() {
    this.authz.authorize('manage', asSubject('Tenant', { id: this.db.tenantId() }));
    const { config } = await this.tenant();
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const rows = await this.db.current().$queryRaw<
      { tokens: bigint; micro_usd: bigint; calls: number; pending: number }[]
    >`SELECT tokens,micro_usd,calls,pending FROM ai_usage WHERE tenant_id=${this.db.tenantId()}::uuid AND month=${month}::date`;
    const row = rows[0];
    return {
      month,
      tokens: Number(row?.tokens ?? 0),
      microUsd: Number(row?.micro_usd ?? 0),
      calls: row?.calls ?? 0,
      pending: row?.pending ?? 0,
      quotaTokens: config.monthlyTokens,
      quotaMicroUsd: config.monthlyMicroUsd,
    };
  }
  /** This route owns short tenant transactions; no database connection spans provider I/O. */
  private scoped<T>(fn: (tx: TransactionClient) => Promise<T>) {
    const context = requestContext.require();
    return this.db.run(this.db.tenantId(), (tx) =>
      requestContext.run({ ...context, tx }, () => fn(tx)),
    );
  }
  async generate(input: AiRequest) {
    const ctx = requestContext.require();
    const principal = ctx.principal;
    if (principal?.type !== 'user' || principal.authMethod !== 'sso') throw new ForbiddenError();
    const prepared = await this.scoped(async (tx) => {
      const { tenant, config } = await this.tenant(tx);
      if (tenant.status !== 'active' || !this.env.AI_ENABLED || !config.enabled)
        throw new DomainError('VERBIS_AI_DISABLED');
      const endpoint = this.endpoints().find((e) => e.id === config.endpointId);
      if (!endpoint || !endpoint.models.includes(config.model) || !config.secretRef)
        throw new DomainError('VERBIS_AI_UNAVAILABLE');
      const agent = ['reply', 'objection', 'summary', 'navigate'].includes(input.task);
      let document = input.document;
      let text = input.text;
      const objections: string[] = [];
      let dispositions: string[] = [];
      let pages: { id: string; name: string }[] = [];
      if (agent) {
        if (!config.agentEnabled || !input.sessionId || input.file || input.document)
          throw new ForbiddenError();
        const row = await this.runtime.row(input.sessionId);
        this.runtime.authorize(row, true);
        if (
          row.kind !== 'interaction' ||
          !row.interaction ||
          (input.task !== 'summary' && !['chat', 'email'].includes(row.interaction.channelType))
        )
          throw new ForbiddenError();
        if (input.task !== 'summary' && !['active', 'paused'].includes(row.state))
          throw new ForbiddenError();
        if (input.task === 'summary' && !['wrapup', 'completed', 'abandoned'].includes(row.state))
          throw new ForbiddenError();
        document = this.runtime.document(row);
        const interaction = this.runtime.interaction(row);
        text = JSON.stringify({
          transcript:
            interaction['channel.chat.transcript'] ??
            interaction['transcript'] ??
            interaction['email.body'] ??
            '',
          operatorContext: input.text,
        });
        const snapshot = await this.runtime.snapshot(row);
        if (input.task === 'navigate')
          pages = ScriptDocumentSchema.parse(document)
            .pages.filter((page) => page.id !== snapshot.currentPage)
            .map((page) => ({ id: page.id, name: page.name }));
        walkNodes(ScriptDocumentSchema.parse(document), ({ node, pageId }) => {
          if (pageId === snapshot.currentPage && node.type === 'objectionHandler')
            objections.push(node.id);
        });
        const campaign = row.interaction.campaignId
          ? await tx.campaign.findFirst({
              where: { id: row.interaction.campaignId, tenantId: tenant.id, deletedAt: null },
              select: { outcomeSet: true },
            })
          : null;
        dispositions = z
          .array(z.looseObject({ code: z.string() }))
          .parse(campaign?.outcomeSet ?? [])
          .map((x) => x.code);
      } else {
        if (input.file && input.task !== 'draft') throw new ForbiddenError();
        if (input.sessionId) throw new ForbiddenError();
        if (input.scriptId) await this.scripts.authorizeRead(input.scriptId);
        // Scoped Script read grants do not grant arbitrary draft generation outside a campaign.
        else this.authz.authorize('create', asSubject('Script', { campaignIds: [] }));
        if (document && !validateScriptDocument(document).ok)
          throw new DomainError('VERBIS_AI_OUTPUT');
        if (input.task === 'scenarios' && !document) throw new DomainError('VERBIS_AI_OUTPUT');
      }
      const secret = await tx.secret.findFirst({
        where: { tenantId: tenant.id, id: config.secretRef, deletedAt: null },
        select: { id: true, ciphertext: true, keyVersion: true },
      });
      if (!secret) throw new DomainError('VERBIS_AI_UNAVAILABLE');
      const key = await this.vault.decrypt(
        tenant.id,
        secret.id,
        secret.keyVersion,
        secret.ciphertext,
      );
      return {
        config,
        endpoint,
        key,
        secretId: secret.id,
        document,
        text,
        objections,
        dispositions,
        pages,
      };
    });
    const id = uuidv7(),
      month = new Date().toISOString().slice(0, 7) + '-01';
    let maskedCount = 0;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reservedTokens = 0;
    let reservedCost = 0;
    let reserved = false;
    // Sanitization failures are also audited, with no source content or provider request.
    try {
      const source = input.file ? await extractText(input.file) : prepared.text;
      const original = JSON.stringify({
        text: source,
        document: prepared.document ?? null,
        objectionIds: prepared.objections,
        dispositionCodes: prepared.dispositions,
        pageChoices: prepared.pages,
      });
      if (original.length > 200000) throw new Error('INPUT_LIMIT');
      const patterns = maskPatterns(original);
      const redactor = z
        .strictObject({ url: z.url(), addresses: z.array(z.string()).min(1) })
        .parse(JSON.parse(this.env.AI_REDACTOR_JSON));
      if (
        redactor.addresses.some((a) => !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(a))
      )
        throw new Error('REDACTOR_NOT_LOCAL');
      const local = RedactorSchema.parse(
        await postJson(
          redactor.url,
          redactor.addresses,
          { text: patterns.text, locale: input.locale },
          {},
          AbortSignal.timeout(10000),
        ),
      );
      const second = maskPatterns(local.text);
      maskedCount = patterns.count + local.count + second.count;
      const data = JSON.stringify({ UNTRUSTED_DATA: second.text }),
        system = systemPrompt(input);
      const inputHash = createHash('sha256').update(data).digest('hex');
      // UTF-8 bytes plus protocol overhead is intentionally conservative; no chars/4 guess.
      const inputReserve = Buffer.byteLength(system + data) * 2 + 2048;
      reservedTokens = inputReserve + prepared.config.maxOutputTokens;
      reservedCost = cost(inputReserve, prepared.config.maxOutputTokens, prepared.config);
      await this.scoped(async (tx) => {
        const latest = await this.tenant(tx);
        if (
          latest.tenant.status !== 'active' ||
          !latest.config.enabled ||
          !this.env.AI_ENABLED ||
          JSON.stringify(latest.config) !== JSON.stringify(prepared.config)
        )
          throw new DomainError('VERBIS_AI_DISABLED');
        await tx.$executeRaw`INSERT INTO ai_usage(tenant_id,month) VALUES(${this.db.tenantId()}::uuid,${month}::date) ON CONFLICT DO NOTHING`;
        const count =
          await tx.$executeRaw`UPDATE ai_usage SET tokens=tokens+${reservedTokens},micro_usd=micro_usd+${reservedCost},calls=calls+1,pending=pending+1 WHERE tenant_id=${this.db.tenantId()}::uuid AND month=${month}::date AND tokens+${reservedTokens}<=${prepared.config.monthlyTokens} AND micro_usd+${reservedCost}<=${prepared.config.monthlyMicroUsd} AND pending<4`;
        if (!count) throw new DomainError('VERBIS_AI_QUOTA');
        const inserted =
          await tx.$executeRaw`INSERT INTO ai_calls(id,tenant_id,request_id,actor_id,month,task,model,input_hash,reserved_tokens,reserved_micro_usd) VALUES(${id}::uuid,${this.db.tenantId()}::uuid,${input.requestId}::uuid,${principal.id}::uuid,${month}::date,${input.task},${prepared.config.model},${inputHash},${reservedTokens},${reservedCost}) ON CONFLICT DO NOTHING`;
        if (!inserted)
          throw new ConflictError(
            'AI request already consumed; use a new request id only for an intentional new call',
          );
        await this.audit.record(tx, {
          action: 'ai.call.reserved',
          target: { type: 'AiCall', id },
          metadata: {
            inputHash,
            model: prepared.config.model,
            provider: prepared.endpoint.provider,
            residency: prepared.endpoint.residency,
            task: input.task,
            reservedTokens,
            reservedMicroUsd: reservedCost,
          },
        });
        await tx.secret.update({
          where: { id: prepared.secretId },
          data: { lastUsedAt: new Date() },
        });
      });
      reserved = true;
      const result = await this.provider.complete(
        prepared.endpoint,
        prepared.key,
        prepared.config.model,
        system,
        data,
        prepared.config.maxOutputTokens,
        AbortSignal.timeout(60000),
      );
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      if (
        inputTokens > inputReserve ||
        inputTokens + outputTokens > reservedTokens ||
        outputTokens > prepared.config.maxOutputTokens
      )
        throw new Error('USAGE_OVERFLOW');
      const value = validateOutput(
        input.task,
        JSON.parse(result.text) as unknown,
        prepared.document,
      );
      if (['reply', 'objection', 'summary', 'navigate'].includes(input.task)) {
        const proposal = z
          .looseObject({
            pageId: z.string().nullable().optional(),
            objectionNodeId: z.string().nullable().optional(),
            disposition: z.string().nullable().optional(),
          })
          .parse(value);
        if (
          (proposal.objectionNodeId && !prepared.objections.includes(proposal.objectionNodeId)) ||
          (proposal.disposition && !prepared.dispositions.includes(proposal.disposition)) ||
          (proposal.pageId && !prepared.pages.some((page) => page.id === proposal.pageId))
        )
          throw new Error('UNAPPROVED_REFERENCE');
      }
      await this.finish(
        id,
        month,
        'completed',
        reservedTokens,
        reservedCost,
        inputTokens,
        outputTokens,
        prepared.config,
      );
      return {
        callId: id,
        task: input.task,
        requiresHumanApproval: true as const,
        value,
        inputTokens,
        outputTokens,
        maskedCount,
      };
    } catch (error) {
      if (reserved)
        await this.finish(
          id,
          month,
          'failed',
          reservedTokens,
          reservedCost,
          inputTokens,
          outputTokens,
          prepared.config,
        );
      else
        await this.scoped((tx) =>
          this.audit.record(tx, {
            action: 'ai.call.denied',
            target: { type: 'AiCall', id },
            outcome: 'denied',
            reason: error instanceof DomainError ? error.code : 'SANITIZATION_FAILED',
            metadata: { task: input.task, model: prepared.config.model },
          }),
        );
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        inputTokens === undefined ? 'VERBIS_AI_UNAVAILABLE' : 'VERBIS_AI_OUTPUT',
      );
    }
  }
  private async finish(
    id: string,
    month: string,
    state: string,
    reservedTokens: number,
    reservedCost: number,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    config: AiConfig,
  ) {
    // Unknown/over-reported usage retains the full reservation (provider may already have billed).
    const tokens =
      inputTokens !== undefined && outputTokens !== undefined
        ? Math.max(0, inputTokens + outputTokens)
        : reservedTokens;
    const actualCost =
      inputTokens !== undefined && outputTokens !== undefined
        ? cost(inputTokens, outputTokens, config)
        : reservedCost;
    await this.scoped(async (tx) => {
      const changed =
        await tx.$executeRaw`UPDATE ai_calls SET state=${state},input_tokens=${inputTokens ?? null},output_tokens=${outputTokens ?? null},finished_at=now() WHERE id=${id}::uuid AND state='reserved'`;
      if (!changed) return;
      if (tokens > reservedTokens || actualCost > reservedCost) {
        await tx.$executeRaw`UPDATE tenants SET settings=jsonb_set(settings,'{ai,enabled}','false'::jsonb),version=version+1,updated_at=now() WHERE id=${this.db.tenantId()}::uuid`;
        await this.audit.record(tx, {
          action: 'ai.configuration.disabled',
          target: { type: 'Tenant', id: this.db.tenantId() },
          reason: 'USAGE_OVERFLOW',
        });
      }
      await tx.$executeRaw`UPDATE ai_usage SET tokens=tokens-${reservedTokens}+${tokens},micro_usd=micro_usd-${reservedCost}+${actualCost},pending=pending-1 WHERE tenant_id=${this.db.tenantId()}::uuid AND month=${month}::date`;
      await this.audit.record(tx, {
        action: 'ai.call.finished',
        target: { type: 'AiCall', id },
        outcome: state === 'completed' ? 'success' : 'failure',
        metadata: {
          state,
          model: config.model,
          inputTokens: inputTokens ?? null,
          outputTokens: outputTokens ?? null,
          microUsd: actualCost,
        },
      });
      await this.outbox.record(tx, {
        type: 'verbis.admin.ai.called.v1',
        aggregateType: 'AiCall',
        aggregateId: id,
        payload: { state, inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null },
      });
    });
  }
}
