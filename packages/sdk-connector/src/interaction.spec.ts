import { describe, expect, it } from 'vitest';

import { canTransition, parseInteractionEvent, STATUS_OF_EVENT } from './interaction.js';

const base = {
  eventId: 'evt-1',
  type: 'interactionOffered',
  occurredAt: '2026-10-01T10:00:00.000Z',
  platformInteractionId: 'conv-1',
  channel: 'chat',
  direction: 'inbound',
};

describe('interaction events', () => {
  it('parses and defaults attributes', () => {
    expect(parseInteractionEvent(base)).toMatchObject({ attributes: {}, channel: 'chat' });
  });
  it('rejects context of another channel, nested attributes and bad ids', () => {
    expect(() => parseInteractionEvent({ ...base, context: { channel: 'voice' } })).toThrow();
    expect(() => parseInteractionEvent({ ...base, attributes: { a: { b: 1 } } })).toThrow();
    expect(() => parseInteractionEvent({ ...base, platformInteractionId: 'a b' })).toThrow();
    expect(() => parseInteractionEvent({ ...base, type: 'exploded' })).toThrow();
    expect(() => parseInteractionEvent({ ...base, extra: true })).toThrow();
  });
  it('maps every event type to a status and guards transitions', () => {
    expect(STATUS_OF_EVENT.resumed).toBe('connected');
    expect(STATUS_OF_EVENT.wrapupRequired).toBe('wrapup');
    expect(canTransition(undefined, 'connected')).toBe(true);
    expect(canTransition('alerting', 'connected')).toBe(true);
    expect(canTransition('connected', 'held')).toBe(true);
    expect(canTransition('held', 'connected')).toBe(true);
    expect(canTransition('ended', 'connected')).toBe(false);
    expect(canTransition('wrapup', 'held')).toBe(false);
  });
});
