import { describe, expect, it } from 'vitest';

import { mapPlatformEvent, PayloadRejectedError } from '@verbis/sdk-connector';

import { attributeKey, channelOf, createGenesysMapper, flatAttributes } from './mapper.js';

const mapper = createGenesysMapper(
  { lastHoldStart: () => undefined },
  () => new Date('2026-10-01T10:00:00.000Z'),
);
const conv = (media: string, comm: Record<string, unknown>) => ({
  topicName: 'v2.users.0f0c2a1e-0000-4000-8000-000000000101.conversations',
  eventBody: {
    id: '0f0c2a1e-0000-4000-8000-000000000009',
    participants: [
      { id: 'p-cust', purpose: 'customer', address: '+905550000000' },
      {
        id: 'p-agent',
        purpose: 'agent',
        userId: 'u-1',
        [media]: [{ id: 'comm-1', state: 'alerting', ...comm }],
      },
    ],
  },
});

describe('genesys cloud mapper', () => {
  it.each([
    ['calls', {}, 'voice'],
    ['callbacks', {}, 'callback'],
    ['chats', {}, 'chat'],
    ['emails', { subject: 'Konu' }, 'email'],
    ['messages', { type: 'sms' }, 'sms'],
    ['messages', { type: 'whatsapp' }, 'whatsapp'],
    ['messages', { type: 'webmessaging' }, 'chat'],
    ['messages', { type: 'open' }, 'chat'],
  ])('maps %s %j to channel %s', (media, comm, channel) => {
    const [event] = mapPlatformEvent(mapper, conv(media, comm));
    expect(event).toMatchObject({ type: 'interactionOffered', channel, agent: { id: 'u-1' } });
  });

  it('maps social message types to the social channel without inventing context', () => {
    expect(channelOf({ media: 'messages', communication: { id: 'x', type: 'facebook' } })).toBe(
      'social',
    );
    const [event] = mapPlatformEvent(mapper, conv('messages', { type: 'instagram' }));
    expect(event?.context).toBeUndefined();
  });

  it('normalises Genesys participant data keys and keeps scalars only', () => {
    expect(attributeKey('Customer Tier')).toBe('Customer_Tier');
    expect(attributeKey('???')).toBeUndefined();
    expect(flatAttributes({ a: 'x'.repeat(2_000), b: 1, c: { nested: true }, d: [1] })).toEqual({
      a: 'x'.repeat(1_000),
      b: 1,
    });
  });

  it('ignores conversations without an agent leg (IVR/ACD only) and rejects malformed ones', () => {
    expect(
      mapPlatformEvent(mapper, {
        topicName: 'v2.routing.queues.q1.conversations',
        eventBody: {
          id: 'c-1',
          participants: [{ id: 'p1', purpose: 'ivr', calls: [{ id: 'x', state: 'connected' }] }],
        },
      }),
    ).toEqual([]);
    expect(() =>
      mapPlatformEvent(mapper, {
        topicName: 'v2.users.u.conversations',
        eventBody: { id: 'c 1', participants: [] },
      }),
    ).toThrow(PayloadRejectedError);
  });
});
