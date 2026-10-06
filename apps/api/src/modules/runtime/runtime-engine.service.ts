import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import { instruments } from '@verbis/observability';
import {
  walkNodes,
  JsonValueSchema,
  ScriptDocumentSchema,
  type JsonValue,
  type ScriptDocument,
} from '@verbis/script-schema';

import { requestContext } from '../../common/context/request-context.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/domain-errors.js';
import { actorRef } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionEventWriter } from '../audit/session-events/session-event.writer.js';
import { AuthzService } from '../authz/authz.service.js';
import { OutcomeSchema } from '../campaigns/campaigns.dto.js';
import { decodeDocument } from '../scripts/document-storage.js';

import {
  assertSequence,
  persistedSnapshot,
  safeSnapshot,
  TERMINAL,
  transition,
  validateVariable,
  type Command,
  type RuntimeSnapshot,
  type RuntimeState,
  type WriteClaim,
  type LeaseSchema,
  type OutcomeInputSchema,
  type RecordingSchema,
  type SecureFieldSchema,
  type TransferSchema,
} from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimePorts } from './runtime-ports.js';
import { RuntimeStateStore } from './runtime-state.store.js';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

export const sessionInclude = {
  scriptVersion: { select: { document: true, documentEncoding: true, documentCompressed: true } },
  interaction: true,
} as const;
export type EngineSession = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export function writableLease(
  row: Pick<EngineSession, 'writerHash' | 'writerTabId' | 'writerBffId' | 'writerUntil'>,
  claim: { writeToken: string; tabId: string },
  bffId: string,
  now: number,
): boolean {
  return (
    row.writerHash === tokenHash(claim.writeToken) &&
    row.writerTabId === claim.tabId &&
    row.writerBffId === bffId &&
    row.writerUntil !== null &&
    row.writerUntil.getTime() > now
  );
}

@Injectable()
export class RuntimeEngineService {
  private readonly logger = new Logger(RuntimeEngineService.name);
  private lastCacheFailureAt = -Infinity;
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(SessionEventWriter) private readonly events: SessionEventWriter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(RuntimeStateStore) private readonly store: RuntimeStateStore,
    @Inject(RuntimePorts) private readonly ports: RuntimePorts,
    @Inject(RuntimeCipher) private readonly keys: RuntimeCipher,
  ) {}

  /** Called in the secure launch redemption transaction after creating a pinned session. */
  async initialize(id: string): Promise<void> {
    const row = await this.row(id, true);
    if (row.state !== 'launching' || row.sequence !== 0)
      throw new ConflictError('Session is already initialized');
    await this.save(row, await this.snapshot(row), 'launching', 'session.created', {});
  }

  async row(id: string, lock = false): Promise<EngineSession> {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    if (lock)
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    const row = await tx.session.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: sessionInclude,
    });
    if (row === null) throw new NotFoundError('Session');
    const document = ScriptDocumentSchema.parse(await decodeDocument(row.scriptVersion));
    return {
      ...row,
      scriptVersion: { ...row.scriptVersion, document: document as unknown as Prisma.JsonObject },
    };
  }
  authorize(row: EngineSession, write = false): void {
    this.authz.authorize(
      write ? 'update' : 'read',
      asSubject('Session', {
        agentId: row.userId,
        teamId: row.teamId ?? '__unassigned__',
        tenantId: row.tenantId,
      }),
    );
    if (
      write &&
      (requestContext.require().principal?.type !== 'user' ||
        requestContext.require().principal?.id !== row.userId)
    )
      throw new ForbiddenError();
  }
  interaction(row: EngineSession): Record<string, JsonValue> {
    if (!row.interaction) return {};
    const attributes = z.object({ sealed: z.string() }).safeParse(row.interaction.attributes);
    if (!attributes.success) return {};
    const data = z
      .record(z.string(), JsonValueSchema)
      .parse(
        JSON.parse(
          this.keys.openString(
            attributes.data.sealed,
            `runtime:interaction:${row.tenantId}:${row.interaction.id}`,
          ),
        ),
      );
    const attached = data['attachedData'];
    return {
      ...data,
      ...(attached && typeof attached === 'object' && !Array.isArray(attached) ? attached : {}),
      queue: row.interaction.queue,
      channel: row.interaction.channelType,
      status: row.interaction.status,
    };
  }
  mappedPlatformIdentity(
    interaction: { id: string; attributes: unknown },
    tenantId: string,
  ): string | undefined {
    const envelope = z.object({ sealed: z.string() }).safeParse(interaction.attributes);
    if (!envelope.success) return undefined;
    const data = z
      .object({ platformAgentId: z.string().optional() })
      .parse(
        JSON.parse(
          this.keys.openString(
            envelope.data.sealed,
            `runtime:interaction:${tenantId}:${interaction.id}`,
          ),
        ),
      );
    return data.platformAgentId;
  }
  document(row: EngineSession): ScriptDocument {
    return ScriptDocumentSchema.parse(row.scriptVersion.document);
  }
  async view(id: string, supervisor = false) {
    const row = await this.row(id);
    return this.viewFromRow(row, supervisor);
  }
  async viewFromRow(row: EngineSession, supervisor = false) {
    this.authorize(row);
    const own = requestContext.require().principal?.id === row.userId;
    const snapshot = await this.snapshot(row);
    return {
      id: row.id,
      state: row.state,
      sequence: row.sequence,
      readOnly: true,
      snapshot: safeSnapshot(snapshot, this.document(row).variables, supervisor || !own),
    };
  }
  async observation(id: string, phase: 'started' | 'stopped') {
    const row = await this.row(id);
    this.authorize(row);
    await this.audit.record(this.db.current(), {
      action: `runtime.session.observation${phase}`,
      target: { type: 'Session', id },
    });
  }
  async snapshot(row: EngineSession): Promise<RuntimeSnapshot> {
    const snapshot = await this.store.read(
      row.tenantId,
      row.id,
      row.sequence,
      row.variables,
      row.version,
    );
    if (row.sequence === 0)
      for (const variable of this.document(row).variables) {
        if (
          variable.classification !== 'pci' &&
          variable.default !== undefined &&
          !(variable.key in snapshot.variables)
        )
          snapshot.variables[variable.key] = variable.default;
      }
    return snapshot;
  }
  actor(): string {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new ForbiddenError();
    return actorRef(principal);
  }
  bffId(): string {
    const principal = requestContext.require().principal;
    if (principal?.type !== 'user' || principal.sessionId === undefined)
      throw new ForbiddenError('A browser session is required');
    return principal.sessionId;
  }
  async attach(id: string, input: z.infer<typeof LeaseSchema>, takeover = false) {
    const row = await this.row(id, true);
    this.authorize(row, true);
    const bffId = this.bffId(),
      now = Date.now();
    let writeToken: string | undefined;
    const existing =
      input.writeToken !== undefined &&
      writableLease(row, { ...input, writeToken: input.writeToken }, bffId, now);
    const available =
      !TERMINAL.has(row.state) &&
      !(row.interaction?.status === 'transferred' && row.interaction.agentId !== row.userId) &&
      (takeover || row.writerUntil === null || row.writerUntil.getTime() <= now || existing);
    const leaseUntil = available ? new Date(now + 60_000) : row.writerUntil;
    if (available) {
      writeToken = existing ? input.writeToken : randomBytes(32).toString('base64url');
      if (writeToken === undefined) throw new Error('Missing write token');
      await this.db.current().session.update({
        where: { id, tenantId: row.tenantId },
        data: {
          writerHash: tokenHash(writeToken),
          writerTabId: input.tabId,
          writerBffId: bffId,
          writerUntil: leaseUntil,
          updatedBy: this.actor(),
        },
      });
      await this.audit.record(this.db.current(), {
        action: takeover ? 'runtime.session.writerTakenOver' : 'runtime.session.attached',
        target: { type: 'Session', id },
        metadata: { readOnly: false },
      });
    }
    const snapshot = await this.snapshot(row);
    return {
      id,
      state: row.state,
      sequence: row.sequence,
      readOnly: !available,
      snapshot: safeSnapshot(snapshot, this.document(row).variables),
      ...(writeToken === undefined ? {} : { writeToken }),
      leaseUntil: leaseUntil?.toISOString() ?? null,
    };
  }
  async release(id: string, input: z.infer<typeof LeaseSchema>) {
    const row = await this.row(id, true);
    this.authorize(row, true);
    if (
      !input.writeToken ||
      !writableLease(
        row,
        { tabId: input.tabId, writeToken: input.writeToken },
        this.bffId(),
        Date.now(),
      )
    )
      throw new ForbiddenError('Only the current writer may release the lease');
    await this.db.current().session.update({
      where: { id, tenantId: row.tenantId },
      data: {
        writerHash: null,
        writerTabId: null,
        writerBffId: null,
        writerUntil: null,
        updatedBy: this.actor(),
      },
    });
    await this.audit.record(this.db.current(), {
      action: 'runtime.session.writerReleased',
      target: { type: 'Session', id },
    });
    return this.viewFromRow(row);
  }
  claim(
    row: EngineSession,
    input: Pick<WriteClaim, 'expectedSequence' | 'writeToken' | 'tabId'>,
    allowHandoff = false,
  ): void {
    this.authorize(row, true);
    assertSequence(row.sequence, input.expectedSequence);
    if (
      !allowHandoff &&
      row.interaction?.status === 'transferred' &&
      row.interaction.agentId !== row.userId
    )
      throw new ConflictError('Interaction belongs to another agent');
    if (TERMINAL.has(row.state) || !writableLease(row, input, this.bffId(), Date.now()))
      throw new ConflictError('Session is read-only; acquire a live writer lease');
  }
  async command(id: string, input: Command) {
    const row = await this.row(id, true);
    this.claim(row, input);
    const snapshot = await this.snapshot(row),
      document = this.document(row),
      command = input.command;
    let state: RuntimeState = row.state,
      type: string,
      payload: Record<string, unknown>;
    if (command.type === 'transition') {
      state = transition(row.state, command.state);
      type = 'session.transitioned';
      payload = { from: row.state, to: state };
    } else {
      if (row.state !== 'active' && row.state !== 'wrapup')
        throw new ConflictError('Session is not editable');
      if (command.type === 'field') {
        const definition = document.variables.find((v) => v.key === command.variable);
        validateVariable(definition, command.value);
        snapshot.variables[command.variable] = command.value;
        type = 'field.changed';
        payload = {
          variable: command.variable,
          value:
            !definition?.persist || definition.pii || definition.classification === 'pii'
              ? '[REDACTED]'
              : command.value,
        };
      } else if (command.type === 'page') {
        if (
          !document.pages.some((p) => p.id === command.pageId) ||
          command.history?.some((id) => !document.pages.some((p) => p.id === id))
        )
          throw new ValidationError([
            { path: '/pageId', message: 'Page is not in the pinned script' },
          ]);
        const pciKeys = new Set(
          document.variables
            .filter((variable) => variable.classification === 'pci')
            .map((variable) => variable.key),
        );
        snapshot.variables = Object.fromEntries(
          Object.entries(snapshot.variables).filter(([key]) => !pciKeys.has(key)),
        );
        snapshot.currentPage = command.pageId;
        snapshot.history = command.history ?? [...snapshot.history, command.pageId].slice(-100);
        type = 'page.entered';
        payload = { pageId: command.pageId };
      } else {
        snapshot.timers = Object.fromEntries(
          Object.entries(snapshot.timers).filter(([, expiry]) => expiry > Date.now()),
        );
        if (
          Object.keys(snapshot.timers).length >= 100 &&
          snapshot.timers[command.timerId] === undefined
        )
          throw new ValidationError([{ path: '/timerId', message: 'Too many active timers' }]);
        snapshot.timers[command.timerId] = Date.now() + command.durationMs;
        type = 'timer.started';
        payload = { timerId: command.timerId, expiresAt: snapshot.timers[command.timerId] };
      }
    }
    return this.save(row, snapshot, state, type, payload);
  }
  async save(
    row: EngineSession,
    snapshot: RuntimeSnapshot,
    state: RuntimeState,
    type: string,
    payload: Record<string, unknown>,
    tx = this.db.current(),
  ) {
    const terminal = TERMINAL.has(state),
      definitions = this.document(row).variables;
    if (terminal) {
      snapshot = persistedSnapshot(
        snapshot,
        definitions.filter((definition) => definition.classification !== 'pci'),
      );
      snapshot.timers = {};
    }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 512_000)
      throw new ValidationError([{ path: '/state', message: 'Runtime state size limit exceeded' }]);
    const sequence = row.sequence + 1;
    const appended = await this.events.append(tx, [{ sessionId: row.id, type, payload }]);
    if (appended[0]?.seq !== sequence)
      throw new ConflictError('Session event watermark is inconsistent');
    const updated = await tx.session.updateMany({
      where: { id: row.id, tenantId: row.tenantId, sequence: row.sequence },
      data: {
        sequence,
        state,
        variables: this.store.seal(row.tenantId, row.id, persistedSnapshot(snapshot, definitions)),
        version: { increment: 1 },
        updatedBy: this.actor(),
        writerUntil: terminal
          ? null
          : row.writerHash !== null && requestContext.require().principal?.id === row.userId
            ? new Date(Date.now() + 60_000)
            : row.writerUntil,
        ...(terminal
          ? {
              endedAt: new Date(),
              writerHash: null,
              writerBffId: null,
              writerTabId: null,
              expiresAt: null,
            }
          : { expiresAt: new Date(Date.now() + (state === 'wrapup' ? 15 * 60_000 : 30 * 60_000)) }),
      },
    });
    if (updated.count !== 1) throw new ConflictError('Concurrent session change');
    await this.audit.record(tx, {
      action: `runtime.session.${type.replaceAll('.', '')}`,
      target: { type: 'Session', id: row.id },
      metadata: { sequence, state },
    });
    const page = this.document(row).pages.find((p) => p.id === snapshot.currentPage);
    const requiredReadIds: string[] = [];
    if (page && type === 'page.entered')
      walkNodes(this.document(row), ({ node, pageId: owner }) => {
        if (owner === page.id && node.props['mustRead'] === true) requiredReadIds.push(node.id);
        return true;
      });
    await this.outbox.record(tx, {
      type: 'verbis.runtime.session.changed.v1',
      aggregateType: 'Session',
      aggregateId: row.id,
      payload: {
        sequence,
        state,
        eventType: type,
        event: payload,
        analytics: {
          pageId: snapshot.currentPage,
          requiredReadIds,
          nodeId:
            type === 'field.observed' || type === 'text.acknowledged'
              ? (payload['name'] ?? null)
              : null,
          durationMs: typeof payload['durationMs'] === 'number' ? payload['durationMs'] : null,
          error: payload['status'] === 'failure',
        },
      },
    });
    // Cache entries are version-bound: if this transaction rolls back, readers ignore this entry.
    await this.store
      .write(
        row.tenantId,
        row.id,
        sequence,
        snapshot,
        definitions.filter((v) => v.classification === 'pci').map((v) => v.key),
        row.version + 1,
      )
      .catch(() => {
        instruments.operationFailures.add(1, { operation: 'runtime.cache.write' });
        if (Date.now() - this.lastCacheFailureAt >= 30000) {
          this.lastCacheFailureAt = Date.now();
          this.logger.error('Runtime cache write unavailable');
        }
        if (
          definitions.some(
            (v) => v.classification === 'pci' && snapshot.variables[v.key] !== undefined,
          )
        )
          throw new ConflictError('Payment state could not be stored');
      });
    if (terminal) await this.events.seal(tx, row.id);
    return {
      id: row.id,
      state,
      sequence,
      readOnly: terminal,
      snapshot: safeSnapshot(snapshot, definitions),
    };
  }
  /** Server execution hooks; payloads are metadata only, never request/response bodies. */
  async recordActivity(id: string, input: unknown): Promise<void> {
    const activity = z
      .strictObject({
        type: z.enum([
          'action.executed',
          'datasource.called',
          'field.observed',
          'text.acknowledged',
        ]),
        name: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
          .max(128),
        status: z.enum(['success', 'failure']),
        durationMs: z.number().int().min(0).max(300_000),
      })
      .parse(input);
    const row = await this.row(id, true);
    this.authorize(row, true);
    if (TERMINAL.has(row.state)) throw new ConflictError('Session is closed');
    if (
      activity.type === 'datasource.called' &&
      !this.document(row).dataSources.some((source) => source.id === activity.name)
    )
      throw new ForbiddenError();
    if (activity.type === 'field.observed' || activity.type === 'text.acknowledged') {
      const permitted: string[] = [];
      const snapshot = await this.snapshot(row);
      walkNodes(this.document(row), ({ node, pageId }) => {
        if (
          pageId === snapshot.currentPage &&
          node.id === activity.name &&
          (activity.type === 'text.acknowledged'
            ? node.props['mustRead'] === true
            : node.bindings.length > 0)
        )
          permitted.push(node.id);
        return true;
      });
      if (!permitted.includes(activity.name)) throw new ForbiddenError();
    }
    await this.save(row, await this.snapshot(row), row.state, activity.type, {
      name: activity.name,
      status: activity.status,
      durationMs: activity.durationMs,
    });
  }

  async outcome(id: string, input: z.infer<typeof OutcomeInputSchema>) {
    const row = await this.row(id, true);
    this.claim(row, input);
    if (
      row.state !== 'wrapup' ||
      row.interaction?.campaignId === null ||
      row.interaction?.campaignId === undefined
    )
      throw new ConflictError('A campaign session in wrap-up is required');
    const campaign = await this.db.current().campaign.findFirst({
      where: { id: row.interaction.campaignId, tenantId: row.tenantId, deletedAt: null },
    });
    if (campaign === null) throw new NotFoundError('Campaign');
    const definition = z
      .array(OutcomeSchema)
      .parse(campaign.outcomeSet)
      .find((o) => o.code === input.code);
    if (
      definition === undefined ||
      input.subCodes.some((code) => !definition.subCodes.includes(code)) ||
      (definition.requiresNote && !input.note?.trim()) ||
      definition.requiredFields.some(
        (key) =>
          input.fields[key] === null || input.fields[key] === undefined || input.fields[key] === '',
      )
    )
      throw new ValidationError([
        { path: '/outcome', message: 'Outcome fields do not satisfy the campaign disposition set' },
      ]);
    const variables = this.document(row).variables;
    for (const [key, value] of Object.entries(input.fields))
      validateVariable(
        variables.find((v) => v.key === key),
        value,
      );
    const outcome = await this.db.current().outcome.create({
      data: {
        tenantId: row.tenantId,
        sessionId: id,
        code: input.code,
        label: definition.label,
        subCodes: input.subCodes,
        callbackAt: input.callbackAt === undefined ? null : new Date(input.callbackAt),
        sealedData: this.keys.seal(
          JSON.stringify({ note: input.note, fields: input.fields }),
          `runtime:outcome:${row.tenantId}:${id}`,
        ),
        createdBy: this.actor(),
        updatedBy: this.actor(),
      },
    });
    await this.outbox.record(this.db.current(), {
      type: 'verbis.runtime.outcome.submitted.v1',
      aggregateType: 'Session',
      aggregateId: id,
      payload: { outcomeId: outcome.id },
    });
    return this.save(
      row,
      await this.snapshot(row),
      transition(row.state, 'completed', true),
      'outcome.submitted',
      { code: input.code },
    );
  }
  async secureField(id: string, input: z.infer<typeof SecureFieldSchema>) {
    const row = await this.row(id, true);
    this.claim(row, input);
    if (row.state !== 'active') throw new ConflictError('Secure fields require an active session');
    const definition = this.document(row).variables.find((v) => v.key === input.variable);
    if (
      !definition ||
      (!['pci', 'pii'].includes(definition.classification) && !definition.pii) ||
      definition.scope === 'global'
    )
      throw new ForbiddenError();
    const verified = await this.ports.verify({
      tenantId: row.tenantId,
      sessionId: id,
      variable: input.variable,
      receipt: input.receipt,
    });
    const snapshot = await this.snapshot(row);
    snapshot.variables[input.variable] = verified.token;
    return this.save(row, snapshot, row.state, 'field.secured', {
      variable: input.variable,
      tokenized: true,
    });
  }
  async recording(id: string, input: z.infer<typeof RecordingSchema>) {
    const row = await this.row(id, true);
    this.claim(row, input);
    if (
      row.state !== 'active' ||
      row.interaction?.channelType !== 'voice' ||
      row.interaction.connectorId === null
    )
      throw new ConflictError('Recording control is unavailable');
    this.ports.connector(row.interaction.connectorId);
    await this.outbox.record(this.db.current(), {
      type: 'verbis.runtime.recording.requested.v1',
      aggregateType: 'Session',
      aggregateId: id,
      payload: { paused: input.paused },
    });
    return this.save(row, await this.snapshot(row), row.state, 'recording.requested', {
      paused: input.paused,
    });
  }
  async transfer(id: string, input: z.infer<typeof TransferSchema>) {
    if (id === input.targetSessionId) throw new ConflictError('Transfer requires another session');
    // Stable lock order prevents deadlocks when two agents attempt a handoff.
    for (const key of [id, input.targetSessionId].sort()) await this.row(key, true);
    const row = await this.row(id),
      target = await this.row(input.targetSessionId);
    this.claim(row, input, true);
    assertSequence(target.sequence, input.targetSequence);
    if (
      row.interactionId === null ||
      row.interactionId !== target.interactionId ||
      row.scriptVersionId !== target.scriptVersionId ||
      row.interaction?.status !== 'transferred' ||
      row.interaction.agentId !== target.userId ||
      row.userId === target.userId ||
      TERMINAL.has(target.state)
    )
      throw new ForbiddenError();
    const tenant = await this.db
      .current()
      .tenant.findUniqueOrThrow({ where: { id: row.tenantId }, select: { settings: true } });
    const policy = z
      .object({
        runtime: z.object({ transferableVariables: z.array(z.string()).default([]) }).prefault({}),
      })
      .loose()
      .parse(tenant.settings);
    const sourceSnapshot = await this.snapshot(row),
      targetSnapshot = await this.snapshot(target),
      definitions = this.document(row).variables;
    for (const key of input.variables) {
      const definition = definitions.find((v) => v.key === key);
      if (
        definition === undefined ||
        !policy.runtime.transferableVariables.includes(key) ||
        !definition.persist ||
        definition.pii ||
        !['public', 'internal'].includes(definition.classification)
      )
        throw new ForbiddenError();
      const value = sourceSnapshot.variables[key];
      if (value !== undefined) targetSnapshot.variables[key] = value;
    }
    await this.save(target, targetSnapshot, target.state, 'context.received', {
      sourceSessionId: id,
      variables: input.variables,
    });
    return this.save(
      row,
      sourceSnapshot,
      row.state === 'active' ? 'paused' : row.state,
      'context.transferred',
      { targetSessionId: target.id, variables: input.variables },
    );
  }
  async expire(tx: TransactionClient, id: string): Promise<void> {
    const row = await this.row(id, true);
    if (TERMINAL.has(row.state) || row.expiresAt === null || row.expiresAt.getTime() > Date.now())
      return;
    await this.save(
      row,
      await this.snapshot(row),
      row.state === 'active' || row.state === 'paused' ? 'abandoned' : 'expired',
      'session.expired',
      {},
      tx,
    );
  }
}
