import { expect, it } from 'vitest';

import { amazonContactEvent } from './amazon-contact-events.js';

const event = {
  source: 'aws.connect',
  'detail-type': 'Amazon Connect Contact Event',
  id: 'event-1',
  time: '2026-10-01T10:00:00Z',
  detail: {
    instanceArn: 'arn:instance',
    contactId: 'contact-1',
    eventType: 'CONNECTED_TO_AGENT',
    channel: 'VOICE',
    initiationMethod: 'INBOUND',
    agentInfo: { agentArn: 'arn:instance/agent/agent-1' },
    queueInfo: { queueArn: 'arn:queue' },
  },
};
it('maps authenticated AWS contact events and pins the instance', () => {
  expect(amazonContactEvent(event, 'arn:instance', { tier: 'gold' })).toMatchObject({
    routingId: 'arn:queue',
    variables: { tier: 'gold' },
    event: { type: 'connected', agent: { id: 'agent-1' } },
  });
  expect(() => amazonContactEvent(event, 'other')).toThrow('Wrong Amazon Connect instance');
  expect(
    amazonContactEvent(
      { ...event, detail: { ...event.detail, eventType: 'FUTURE_EVENT' } },
      'arn:instance',
    ),
  ).toBeUndefined();
});
it('keeps ACW separate from completion', () => {
  expect(
    amazonContactEvent(
      { ...event, detail: { ...event.detail, eventType: 'DISCONNECTED' } },
      'arn:instance',
    )?.event.type,
  ).toBe('wrapupRequired');
  expect(
    amazonContactEvent(
      { ...event, detail: { ...event.detail, eventType: 'COMPLETED' } },
      'arn:instance',
    )?.event.type,
  ).toBe('ended');
});

it.each([
  ['CHAT', 'chat'],
  ['EMAIL', 'email'],
  ['TASK', undefined],
])('maps AWS channel %s without inventing unsupported channels', (channel, expected) => {
  const { agentInfo: _agent, queueInfo: _queue, ...detail } = event.detail;
  const result = amazonContactEvent(
    {
      ...event,
      detail: { ...detail, channel, eventType: 'DISCONNECTED', initiationMethod: 'OUTBOUND' },
    },
    'arn:instance',
  );
  if (expected === undefined) expect(result).toBeUndefined();
  else {
    expect(result?.event).toMatchObject({
      channel: expected,
      direction: 'outbound',
      type: 'ended',
    });
    expect(result?.event).not.toHaveProperty('agent');
    expect(result).not.toHaveProperty('routingId');
    expect(result?.variables).toEqual({});
  }
});
