import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { instruments } from '@verbis/observability';

import { RedisService } from '../../infra/redis/redis.service.js';

import { RuntimeCipher } from './runtime-cipher.js';

/** Final lines kept per interaction (ADR-0052). */
export const TRANSCRIPT_WINDOW = 200;
/** Lines expire this long after the last one; an ended interaction is cleared at once. */
export const TRANSCRIPT_TTL_SECONDS = 3_600;

export const TranscriptLineSchema = z
  .strictObject({
    segmentId: z.string().min(1).max(128),
    speaker: z.enum(['customer', 'agent']),
    text: z.string().min(1).max(2_000),
    final: z.boolean(),
    at: z.iso.datetime({ offset: true }),
    language: z.string().max(5).optional(),
  })
  .meta({ id: 'TranscriptLine' });
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

/**
 * Live transcript window in Redis, sealed per tenant and interaction. Never PostgreSQL, audit,
 * outbox or logs (the text is personal data). Storage is best effort: when Redis is down the line
 * still reaches the agent live and triggers still fire; only the reload window misses it.
 */
@Injectable()
export class TranscriptStore {
  readonly #logger = new Logger(TranscriptStore.name);
  #lastFailureAt = -Infinity;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RuntimeCipher) private readonly cipher: RuntimeCipher,
  ) {}

  /** Appends a final line once per segment id; `first` when it opened the interaction's window. */
  async append(
    tenantId: string,
    interactionId: string,
    line: TranscriptLine,
  ): Promise<{ stored: boolean; first: boolean }> {
    const { lines, ids } = keys(tenantId, interactionId);
    try {
      if ((await this.redis.client.sismember(ids, line.segmentId)) === 1)
        return { stored: false, first: false };
      const sealed = this.cipher.seal(JSON.stringify(line), aad(tenantId, interactionId));
      const results = await this.redis.client
        .multi()
        .sadd(ids, line.segmentId)
        .rpush(lines, sealed)
        .ltrim(lines, -TRANSCRIPT_WINDOW, -1)
        .expire(lines, TRANSCRIPT_TTL_SECONDS)
        .expire(ids, TRANSCRIPT_TTL_SECONDS)
        .exec();
      return { stored: true, first: results?.[1]?.[1] === 1 };
    } catch {
      this.#failed('append');
      return { stored: false, first: false };
    }
  }

  /** Oldest first; a line that no longer opens (rotated key, corruption) is skipped. */
  async read(tenantId: string, interactionId: string): Promise<TranscriptLine[]> {
    let sealed: string[];
    try {
      sealed = await this.redis.client.lrange(keys(tenantId, interactionId).lines, 0, -1);
    } catch {
      this.#failed('read');
      return [];
    }
    return sealed.flatMap((value) => {
      try {
        return [
          TranscriptLineSchema.parse(
            JSON.parse(this.cipher.openString(value, aad(tenantId, interactionId))),
          ),
        ];
      } catch {
        return [];
      }
    });
  }

  async clear(tenantId: string, interactionId: string): Promise<void> {
    const { lines, ids } = keys(tenantId, interactionId);
    try {
      await this.redis.client.del(lines, ids);
    } catch {
      this.#failed('clear');
    }
  }

  #failed(operation: string): void {
    instruments.operationFailures.add(1, { operation: `runtime.transcript.${operation}` });
    if (Date.now() - this.#lastFailureAt < 30_000) return;
    this.#lastFailureAt = Date.now();
    this.#logger.error('Transcript store unavailable');
  }
}

const keys = (tenantId: string, interactionId: string) => {
  const base = `runtime:transcript:${tenantId}:${interactionId}`;
  return { lines: `${base}:lines`, ids: `${base}:ids` };
};
const aad = (tenantId: string, interactionId: string) =>
  `runtime:transcript:${tenantId}:${interactionId}`;
