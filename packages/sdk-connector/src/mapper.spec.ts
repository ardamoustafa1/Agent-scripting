import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PayloadRejectedError } from './errors.js';
import { defineMapper, mapPlatformEvent } from './mapper.js';

const mapper = defineMapper({
  name: 'test',
  payloadSchema: z.object({ id: z.string(), kind: z.enum(['ring', 'noise', 'bad']) }),
  map: (p) =>
    p.kind === 'noise'
      ? null
      : {
          eventId: `e-${p.id}`,
          type: 'interactionOffered',
          occurredAt: '2026-10-01T10:00:00.000Z',
          platformInteractionId: p.kind === 'bad' ? 'has space' : p.id,
          channel: 'voice',
          direction: 'inbound',
        },
});

describe('mapPlatformEvent', () => {
  it('maps, ignores, and rejects', () => {
    expect(mapPlatformEvent(mapper, { id: 'c1', kind: 'ring' })).toMatchObject([
      { platformInteractionId: 'c1' },
    ]);
    expect(mapPlatformEvent(mapper, { id: 'c1', kind: 'noise' })).toEqual([]);
    expect(() => mapPlatformEvent(mapper, { id: 1 })).toThrow(PayloadRejectedError);
    expect(() => mapPlatformEvent(mapper, { id: 'c1', kind: 'bad' })).toThrow(PayloadRejectedError);
  });
});
