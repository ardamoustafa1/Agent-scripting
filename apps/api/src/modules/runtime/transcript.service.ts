import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { luhn } from '@verbis/expr';
import { inSpan } from '@verbis/observability';
import {
  evaluateTriggers,
  TriggerActionSchema,
  type TriggerAction,
  type TriggerHistoryEntry,
} from '@verbis/script-schema';
import { type TranscriptSegment } from '@verbis/sdk-connector';

import { NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import { TERMINAL } from './domain/runtime.js';
import { RuntimeEngineService, type EngineSession } from './runtime-engine.service.js';
import { RuntimeGateway } from './runtime.gateway.js';
import { TranscriptStore, type TranscriptLine } from './transcript.store.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

/** Session events of the transcript triggers (metadata only, never the spoken text). */
export const TRIGGERED = 'transcript.triggered';
export const RESOLVED = 'prompt.resolved';
/** Prompts shown at once; older pending ones wait until these are resolved. */
export const MAX_PROMPTS = 5;

export const TranscriptPromptSchema = z
  .object({
    triggerId: z.string(),
    segmentId: z.string(),
    speaker: z.enum(['customer', 'agent']),
    firedAt: z.iso.datetime(),
    actions: z.array(TriggerActionSchema),
  })
  .meta({ id: 'TranscriptPrompt' });
export type TranscriptPrompt = z.infer<typeof TranscriptPromptSchema>;

const TriggeredPayload = z.object({
  triggerIds: z.array(z.string()),
  speaker: z.enum(['customer', 'agent']),
  segmentId: z.string(),
});
const ResolvedPayload = z.object({ triggerId: z.string() });
const LIVE = new Set(['active', 'paused']);
const DIGIT_RUN = /\d(?:[ -]?\d){12,}/g;

/** Whether a 13–19 digit window of the run passes Luhn (an expiry or CVV may follow the PAN). */
function holdsCardNumber(digits: string): boolean {
  for (let length = Math.min(19, digits.length); length >= 13; length -= 1)
    for (let start = 0; start + length <= digits.length; start += 1)
      if (luhn(digits.slice(start, start + length))) return true;
  return false;
}

/**
 * A card number read out loud must not enter Verbis (PCI-DSS req. 3): a run of 13 or more digits
 * holding a Luhn-valid card number keeps only its last four. Digits a recognizer leaves as words
 * are not caught; payment steps pause transcription on the platform (SECURITY §6.5).
 */
export function maskCardNumbers(text: string): string {
  return text.replace(DIGIT_RUN, (match) => {
    const digits = match.replace(/\D/g, '');
    return holdsCardNumber(digits) ? `•••• ${digits.slice(-4)}` : match;
  });
}

/**
 * Live transcript (ADR-0052, 2026-10-22): connector segments reach the session owner's socket,
 * final ones are kept in the sealed Redis window and evaluated against the pinned script's
 * triggers. A hit is a session event; the agent resolves the prompt it produces.
 */
@Injectable()
export class TranscriptService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(TranscriptStore) private readonly store: TranscriptStore,
    @Inject(RuntimeGateway) private readonly gateway: RuntimeGateway,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Tenant opt-in (`settings.liveTranscript.enabled`), off by default. */
  async enabled(tx: TransactionClient = this.db.current()): Promise<boolean> {
    const tenant = await tx.tenant.findFirst({
      where: { id: this.db.tenantId(), deletedAt: null },
      select: { settings: true },
    });
    return (
      z
        .object({ liveTranscript: z.object({ enabled: z.boolean() }).optional() })
        .safeParse(tenant?.settings ?? {}).data?.liveTranscript?.enabled === true
    );
  }

  /** Connector side: one segment of an interaction the platform reported. */
  async receive(
    interaction: { id: string; status: string; connectorId: string },
    segment: TranscriptSegment,
  ): Promise<{ accepted: boolean }> {
    return inSpan('runtime.transcript.ingest', async () => {
      const tx = this.db.current();
      if (interaction.status === 'ended' || !(await this.enabled(tx))) return { accepted: false };
      const tenantId = this.db.tenantId();
      const now = new Date();
      const text = maskCardNumbers(segment.text);
      const line: TranscriptLine = {
        segmentId: segment.segmentId,
        speaker: segment.speaker,
        text,
        final: segment.final,
        at: now.toISOString(),
        ...(segment.language === undefined ? {} : { language: segment.language }),
      };
      if (segment.final) {
        const { first } = await this.store.append(tenantId, interaction.id, line);
        if (first)
          await this.audit.record(tx, {
            action: 'runtime.transcript.started',
            target: { type: 'Interaction', id: interaction.id },
            interactionId: interaction.id,
            metadata: { connectorId: interaction.connectorId, language: segment.language ?? null },
          });
      }
      const sessions = await tx.session.findMany({
        where: { tenantId, interactionId: interaction.id, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const { id } of sessions) {
        let row = await this.engine.row(id);
        if (TERMINAL.has(row.state)) continue;
        this.gateway.transcript(tenantId, id, line);
        if (!segment.final || !LIVE.has(row.state)) continue;
        const triggers = this.engine.document(row).triggers;
        if (triggers === undefined || triggers.length === 0) continue;
        row = await this.engine.row(id, true);
        if (!LIVE.has(row.state)) continue;
        const snapshot = await this.engine.snapshot(row);
        const firings = evaluateTriggers(
          triggers,
          {
            segmentId: segment.segmentId,
            speaker: segment.speaker,
            text,
            language: segment.language,
            at: now.getTime(),
          },
          { currentPage: snapshot.currentPage, history: await this.history(row, tx) },
        );
        if (firings.length === 0) continue;
        await this.engine.save(
          row,
          snapshot,
          row.state,
          TRIGGERED,
          {
            triggerIds: firings.map((firing) => firing.trigger.id),
            speaker: segment.speaker,
            segmentId: segment.segmentId,
          },
          tx,
        );
      }
      return { accepted: true };
    });
  }

  /** Earlier hits of this session (for `once` and cooldown). */
  async history(
    row: EngineSession,
    tx: TransactionClient = this.db.current(),
  ): Promise<TriggerHistoryEntry[]> {
    const events = await this.events(row, tx, [TRIGGERED]);
    return events.flatMap((event) => {
      const payload = TriggeredPayload.safeParse(event.payload);
      return payload.success
        ? payload.data.triggerIds.map((triggerId) => ({
            triggerId,
            segmentId: payload.data.segmentId,
            at: event.recordedAt.getTime(),
          }))
        : [];
    });
  }

  /** Hits the agent has not resolved yet, newest first, with the actions still useful now. */
  async prompts(row: EngineSession, currentPage: string | null): Promise<TranscriptPrompt[]> {
    const triggers = this.engine.document(row).triggers ?? [];
    if (triggers.length === 0) return [];
    const pending = new Map<string, Omit<TranscriptPrompt, 'actions'>>();
    for (const event of await this.events(row, this.db.current(), [TRIGGERED, RESOLVED])) {
      if (event.type === RESOLVED) {
        const payload = ResolvedPayload.safeParse(event.payload);
        if (payload.success) pending.delete(payload.data.triggerId);
        continue;
      }
      const payload = TriggeredPayload.safeParse(event.payload);
      if (!payload.success) continue;
      for (const triggerId of payload.data.triggerIds) {
        pending.delete(triggerId);
        pending.set(triggerId, {
          triggerId,
          segmentId: payload.data.segmentId,
          speaker: payload.data.speaker,
          firedAt: event.recordedAt.toISOString(),
        });
      }
    }
    return [...pending.values()]
      .reverse()
      .flatMap((prompt) => {
        const actions: TriggerAction[] = (
          triggers.find((trigger) => trigger.id === prompt.triggerId)?.actions ?? []
        ).filter((action) => action.type !== 'suggestPage' || action.pageId !== currentPage);
        return actions.length === 0 ? [] : [{ ...prompt, actions }];
      })
      .slice(0, MAX_PROMPTS);
  }

  /** The agent accepted or dismissed a prompt; only a pending one can be resolved. */
  async resolve(
    row: EngineSession,
    triggerId: string,
    resolution: 'accepted' | 'dismissed',
  ): Promise<void> {
    const snapshot = await this.engine.snapshot(row);
    // Pending regardless of the page shown: a page suggestion hidden on its own page still counts.
    const pending = await this.prompts(row, null);
    if (!pending.some((prompt) => prompt.triggerId === triggerId))
      throw new NotFoundError('Prompt');
    await this.engine.save(row, snapshot, row.state, RESOLVED, { triggerId, resolution });
  }

  /** Stored final lines for the session owner after a reload; reading them is audited. */
  async window(row: EngineSession): Promise<{ enabled: boolean; lines: TranscriptLine[] }> {
    if (!(await this.enabled()) || row.interactionId === null) return { enabled: false, lines: [] };
    const lines = await this.store.read(row.tenantId, row.interactionId);
    await this.audit.record(this.db.current(), {
      action: 'runtime.transcript.viewed',
      target: { type: 'Session', id: row.id },
      interactionId: row.interactionId,
      metadata: { lines: lines.length },
    });
    return { enabled: true, lines };
  }

  private events(row: EngineSession, tx: TransactionClient, types: readonly string[]) {
    return tx.sessionEvent
      .findMany({
        where: { tenantId: row.tenantId, sessionId: row.id, type: { in: [...types] } },
        select: { type: true, payload: true, recordedAt: true, seq: true },
        orderBy: { seq: 'desc' },
        take: 500,
      })
      .then((events) => events.reverse());
  }
}
