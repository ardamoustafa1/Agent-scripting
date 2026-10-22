import { describe, expect, it } from 'vitest';

import { supportsFeature, validateCapabilities } from './capabilities.js';
import { TranscriptSegmentSchema } from './transcript.js';

const segment = {
  segmentId: 'utt-1',
  platformInteractionId: 'conv-42',
  speaker: 'customer',
  text: '  Aboneliğimi iptal etmek istiyorum.  ',
  final: true,
  occurredAt: '2026-10-22T10:00:00.000Z',
};

describe('TranscriptSegmentSchema', () => {
  it('accepts a segment and trims its text', () => {
    expect(TranscriptSegmentSchema.parse(segment).text).toBe('Aboneliğimi iptal etmek istiyorum.');
    expect(TranscriptSegmentSchema.parse({ ...segment, language: 'en-GB' }).language).toBe('en-GB');
  });

  it.each([
    ['blank text', { text: '   ' }],
    ['oversized text', { text: 'a'.repeat(2_001) }],
    ['bot speaker', { speaker: 'bot' }],
    ['unsafe id', { segmentId: 'a b' }],
    ['unsafe interaction id', { platformInteractionId: 'x/y' }],
    ['missing final flag', { final: undefined }],
    ['bad timestamp', { occurredAt: 'yesterday' }],
    ['bad language', { language: 'Turkish' }],
    ['unknown field', { audio: 'base64' }],
  ])('rejects %s', (_, change) => {
    expect(TranscriptSegmentSchema.safeParse({ ...segment, ...change }).success).toBe(false);
  });
});

describe('liveTranscript feature', () => {
  it('is a declarable capability', () => {
    const caps = { channels: ['voice'] as const, features: ['liveTranscript'] as const };
    expect(validateCapabilities(caps)).toEqual([]);
    expect(supportsFeature(caps, 'liveTranscript')).toBe(true);
    expect(supportsFeature({ channels: ['voice'], features: [] }, 'liveTranscript')).toBe(false);
  });
});
