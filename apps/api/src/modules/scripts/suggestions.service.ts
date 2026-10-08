import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  applyJsonPatch,
  JsonPatchError,
  ScriptDocumentSchema,
  type JsonPatchOperation,
} from '@verbis/script-schema';
import {
  SuggestionOperationSchema,
  type Suggestion,
  type SuggestionInput,
  type SuggestionState,
} from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';
import { DomainError, NotFoundError } from '../../common/errors/domain-errors.js';
import { actorRef } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import { buildGuards, guardsHold, type SuggestionGuard } from './domain/suggestion.js';
import { ScriptsService } from './scripts.service.js';
import { TeamService } from './team.service.js';

import type { Prisma } from '../../generated/prisma/client.js';

const Operations = z.array(SuggestionOperationSchema);
const Guards = z.array(
  z.union([
    z.object({ kind: z.literal('value'), path: z.string(), value: z.unknown() }),
    z.object({ kind: z.literal('absent'), path: z.string() }),
    z.object({ kind: z.literal('length'), path: z.string(), length: z.number() }),
  ]),
);

/** Suggestion mode (ADR-0051, DIFFERENTIATORS C2). */
@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
  ) {}

  private actor(): string {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new Error('No principal');
    return actorRef(principal);
  }

  /** The patch applied to `document`, validated as a script document. */
  private apply(document: unknown, operations: readonly JsonPatchOperation[]): unknown {
    let patched: unknown;
    try {
      patched = applyJsonPatch(document as object, operations);
    } catch (error) {
      if (error instanceof JsonPatchError)
        throw new DomainError(
          'VERBIS_SUGGESTION_INVALID',
          `Operation ${error.operation.op} ${error.operation.path} does not apply`,
        );
      throw error;
    }
    const parsed = ScriptDocumentSchema.safeParse(patched);
    if (!parsed.success)
      throw new DomainError(
        'VERBIS_SUGGESTION_INVALID',
        'The suggestion would make the document invalid',
        parsed.error.issues.slice(0, 20).map((issue) => ({
          path: `/${issue.path.join('/')}`,
          message: issue.message,
        })),
      );
    return parsed.data;
  }

  private toDto(
    row: Prisma.ScriptSuggestionGetPayload<object>,
    scriptId: string,
    versionNumber: number,
    document: unknown,
  ): Suggestion {
    const guards = Guards.safeParse(row.guards);
    let state = row.state as SuggestionState;
    if (state === 'open' && !(guards.success && guardsHold(document, guards.data))) state = 'stale';
    return {
      id: row.id,
      scriptId,
      versionNumber,
      title: row.title,
      note: row.note,
      operations: Operations.parse(row.operations),
      state,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy,
      decisionReason: row.decisionReason,
    };
  }

  async create(scriptId: string, number: number, input: SuggestionInput): Promise<Suggestion> {
    const version = await this.team.authorize(scriptId, number, 'read');
    const current = await this.scripts.getVersion(scriptId, number);
    if (current.state !== 'draft')
      throw new DomainError(
        'VERBIS_SCRIPT_VERSION_IMMUTABLE',
        `version is ${current.state}; suggest changes on a draft`,
      );
    const operations = input.operations as JsonPatchOperation[];
    this.apply(current.document, operations);
    const guards = buildGuards(current.document, input.operations);
    const tx = this.db.current();
    const row = await tx.scriptSuggestion.create({
      data: {
        tenantId: this.db.tenantId(),
        scriptVersionId: version.id,
        title: input.title,
        note: input.note ?? null,
        operations: input.operations,
        guards: guards as unknown as Prisma.InputJsonValue,
        baseChecksum: current.checksum,
        createdBy: this.actor(),
      },
    });
    await this.audit.record(tx, {
      action: 'script.suggestion.created',
      target: { type: 'ScriptVersion', id: version.id, name: `${scriptId}#${String(number)}` },
      after: { suggestionId: row.id, state: 'open' },
      metadata: {
        title: input.title,
        operations: input.operations.map((o) => `${o.op} ${o.path}`),
      },
    });
    return this.toDto(row, scriptId, number, current.document);
  }

  async list(scriptId: string, number: number): Promise<Suggestion[]> {
    const version = await this.team.authorize(scriptId, number, 'read');
    const current = await this.scripts.getVersion(scriptId, number);
    const rows = await this.db.current().scriptSuggestion.findMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: version.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((row) => this.toDto(row, scriptId, number, current.document));
  }

  private async open(scriptId: string, number: number, id: string) {
    const version = await this.team.authorize(scriptId, number, 'update');
    const row = await this.db.current().scriptSuggestion.findFirst({
      where: { id, tenantId: this.db.tenantId(), scriptVersionId: version.id },
    });
    if (!row) throw new NotFoundError('Suggestion');
    if (row.state !== 'open')
      throw new DomainError('VERBIS_SUGGESTION_NOT_OPEN', `The suggestion is ${row.state}`);
    return { version, row };
  }

  /** Applies the suggestion to the draft as one new draft state (one audit trail entry each). */
  async accept(scriptId: string, number: number, id: string): Promise<Suggestion> {
    const { version, row } = await this.open(scriptId, number, id);
    const current = await this.scripts.getVersion(scriptId, number);
    if (current.state !== 'draft')
      throw new DomainError('VERBIS_SCRIPT_VERSION_IMMUTABLE', `version is ${current.state}`);
    const guards = Guards.parse(row.guards) as SuggestionGuard[];
    if (!guardsHold(current.document, guards))
      throw new DomainError(
        'VERBIS_SUGGESTION_STALE',
        'The draft changed where this suggestion applies; ask for a new suggestion',
      );
    const document = this.apply(current.document, Operations.parse(row.operations));
    await this.scripts.updateDraft(scriptId, number, current.version, {
      document: document as Record<string, unknown>,
      screens: current.screens.map((s) => ({
        sharedScreenId: s.sharedScreenId,
        versionNumber: s.versionNumber,
        mode: s.mode as 'linked' | 'detached',
      })),
    });
    const tx = this.db.current();
    const decided = await tx.scriptSuggestion.update({
      where: { id: row.id },
      data: { state: 'accepted', decidedAt: new Date(), decidedBy: this.actor() },
    });
    await this.audit.record(tx, {
      action: 'script.suggestion.accepted',
      target: { type: 'ScriptVersion', id: version.id, name: `${scriptId}#${String(number)}` },
      before: { suggestionId: row.id, state: 'open' },
      after: { suggestionId: row.id, state: 'accepted' },
    });
    return this.toDto(decided, scriptId, number, document);
  }

  async reject(
    scriptId: string,
    number: number,
    id: string,
    input: { reason?: string | undefined },
  ): Promise<Suggestion> {
    const { version, row } = await this.open(scriptId, number, id);
    const current = await this.scripts.getVersion(scriptId, number);
    const tx = this.db.current();
    const decided = await tx.scriptSuggestion.update({
      where: { id: row.id },
      data: {
        state: 'rejected',
        decidedAt: new Date(),
        decidedBy: this.actor(),
        decisionReason: input.reason ?? null,
      },
    });
    await this.audit.record(tx, {
      action: 'script.suggestion.rejected',
      target: { type: 'ScriptVersion', id: version.id, name: `${scriptId}#${String(number)}` },
      before: { suggestionId: row.id, state: 'open' },
      after: { suggestionId: row.id, state: 'rejected' },
      metadata: { hasReason: input.reason !== undefined },
    });
    return this.toDto(decided, scriptId, number, current.document);
  }
}
