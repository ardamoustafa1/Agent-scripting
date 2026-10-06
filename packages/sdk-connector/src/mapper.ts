import { z } from 'zod';

import { PayloadRejectedError } from './errors.js';
import {
  parseInteractionEvent,
  type InteractionEvent,
  type InteractionEventInput,
} from './interaction.js';

/**
 * Mapper layer: platform payload → normalized `InteractionEvent`. A mapper validates the raw
 * payload with its own schema (untrusted input), then builds the normalized event, which is
 * validated again. Payloads a mapper does not care about map to `null` (ignored, not an error).
 */
export interface EventMapper<TPayload> {
  readonly name: string;
  readonly payloadSchema: z.ZodType<TPayload>;
  map(payload: TPayload): InteractionEventInput | InteractionEventInput[] | null;
}

export function defineMapper<TPayload>(mapper: EventMapper<TPayload>): EventMapper<TPayload> {
  return mapper;
}

export function mapPlatformEvent<TPayload>(
  mapper: EventMapper<TPayload>,
  raw: unknown,
): InteractionEvent[] {
  const parsed = mapper.payloadSchema.safeParse(raw);
  if (!parsed.success)
    throw new PayloadRejectedError(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    );
  const mapped = mapper.map(parsed.data);
  if (mapped === null) return [];
  try {
    return (Array.isArray(mapped) ? mapped : [mapped]).map(parseInteractionEvent);
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new PayloadRejectedError(
        error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    throw error;
  }
}
