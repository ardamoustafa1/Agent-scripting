import { expect, it } from 'vitest';

import { WorkspaceTranslator } from './workspace-events.js';

const translator = () =>
  new WorkspaceTranslator(
    { agentLoginId: 'synthetic-agent' },
    'synthetic/ref',
    () => new Date('2026-10-03T12:00:00Z'),
  );
const call = (state: string, extra = {}) => ({
  channel: '/workspace/v3/voice',
  data: { messageType: 'CallStateChanged', call: { id: 'interaction', state, ...extra } },
});
const ixn = (state: string, mediatype = 'chat', extra = {}) => ({
  channel: '/workspace/v3/media',
  data: {
    messageType: 'InteractionStateChanged',
    interaction: { id: 'interaction', state, mediatype, ...extra },
  },
});
function translated(t: WorkspaceTranslator, value: unknown) {
  const result = t.translate(value);
  if (result === null || result === 'invalid')
    throw new Error('Expected translated synthetic notification');
  return result;
}
it('separates malformed notifications from ignorable metadata and unsupported states', () => {
  const t = translator();
  expect(t.translate({})).toBe('invalid');
  expect(
    t.translate({ channel: '/workspace/v3/voice', data: { messageType: 'Heartbeat' } }),
  ).toBeNull();
  expect(t.translate(call('Unknown'))).toBeNull();
  expect(t.translate(ixn('Unknown'))).toBeNull();
  const voice = call('Established');
  Object.assign(voice.data, { notificationType: 'AttachedDataChanged' });
  expect(t.translate(voice)).toBeNull();
  const media = ixn('Accepted');
  Object.assign(media.data, { notificationType: 'PropertiesChanged' });
  expect(t.translate(media)).toBeNull();
});
it.each([
  ['Ringing', 'ringing'],
  ['Dialing', 'dialing'],
  ['Established', 'established'],
  ['Held', 'held'],
  ['Released', 'released'],
  ['Completed', 'markedDone'],
])('maps voice state %s to %s', (state, event) => {
  const result = translated(
    translator(),
    call(state, {
      connId: 'connection',
      previousConnId: 'previous',
      ani: 'synthetic-ani',
      dnis: 'synthetic-dnis',
      callType: 'Inbound',
    }),
  );
  expect(result.envelope).toMatchObject({
    event,
    interactionId: 'connection',
    previousInteractionId: 'previous',
    ani: 'synthetic-ani',
    dnis: 'synthetic-dnis',
    callType: 'Inbound',
    source: 'workspace',
    mediaType: 'voice',
  });
});
it.each(['Inbound', 'Outbound', 'Internal', 'Consult', 'Other'])(
  'retains supported call type %s and normalizes unknown values',
  (callType) => {
    expect(translated(translator(), call('Ringing', { callType })).envelope.callType).toBe(
      callType === 'Other' ? 'Unknown' : callType,
    );
  },
);
it.each([
  ['Invite', 'ringing'],
  ['Accepted', 'established'],
  ['Processing', 'established'],
  ['Revoked', 'abandoned'],
  ['Released', 'released'],
  ['Completed', 'markedDone'],
])('maps media state %s to %s', (state, event) => {
  expect(translated(translator(), ixn(state)).envelope.event).toBe(event);
});
it.each(['chat', 'email', 'sms', 'whatsapp', 'webchat', 'facebook', 'twitter', 'other'])(
  'normalizes %s media and attaches only its relevant metadata',
  (media) => {
    const result = translated(
      translator(),
      ixn('Accepted', media.toUpperCase(), {
        queue: 'synthetic-queue',
        userData: [
          { key: 'FromAddress', value: 'synthetic@example.test' },
          { key: 'Subject', value: 's'.repeat(1200) },
          { key: 'FirstName', value: 'Synthetic' },
        ],
      }),
    );
    expect(result.envelope.mediaType).toBe(media === 'other' ? 'workitem' : media);
    expect(result.envelope.queue).toBe('synthetic-queue');
    if (media === 'email')
      expect(result.envelope.email).toEqual({
        from: 'synthetic@example.test',
        to: [],
        subject: 's'.repeat(1000),
        body: '',
      });
    else expect(result.envelope.email).toBeUndefined();
    if (media === 'chat' || media === 'webchat')
      expect(result.envelope.chat).toEqual({ customerName: 'Synthetic', messages: [] });
    else expect(result.envelope.chat).toBeUndefined();
  },
);
it('bounds scalar user data and discards booleans, nested values and non-finite numbers', () => {
  const pairs = [
    { key: 'long', value: 'x'.repeat(5000) },
    { key: 'number', value: 12 },
    { key: 'null', value: null },
    { key: 'boolean', value: false },
    { key: 'object', value: {} },
    { key: 'nonfinite', value: Infinity },
  ];
  expect(translated(translator(), call('Ringing', { userData: pairs })).envelope.userData).toEqual({
    long: 'x'.repeat(4000),
    number: 12,
    null: null,
  });
  expect(translated(translator(), ixn('Accepted', 'email')).envelope.email).toEqual({
    from: '',
    to: [],
    subject: '',
    body: '',
  });
  expect(
    translated(
      translator(),
      ixn('Accepted', 'chat', { userData: [{ key: 'FirstName', value: 12 }] }),
    ).envelope.chat,
  ).toEqual({ messages: [] });
});
it('commits IDs only after acceptance, tracks held/retrieved transitions and resets completed interactions', () => {
  const t = translator(),
    first = translated(t, call('Held'));
  expect(translated(t, call('Held')).envelope.eventId).toBe(first.envelope.eventId);
  first.commit();
  expect(translated(t, call('Held')).envelope.eventId).toMatch(/:held:2$/);
  const retrieve = translated(t, call('Established'));
  expect(retrieve.envelope.event).toBe('retrieved');
  retrieve.commit();
  expect(translated(t, call('Established')).envelope.event).toBe('established');
  translated(t, call('Completed')).commit();
  expect(translated(t, call('Held')).envelope.eventId).toBe(first.envelope.eventId);
  first.commit();
  translated(t, ixn('Revoked')).commit();
  expect(translated(t, call('Held')).envelope.eventId).toBe(first.envelope.eventId);
  const unsafe = translated(t, call('Ringing', { id: 'interaction/unsafe' }));
  expect(unsafe.envelope.interactionId).toBe('interaction_unsafe');
  expect(unsafe.envelope.eventId).not.toContain('/');
});
it('bounds retained interaction counters while keeping recently accepted notifications deterministic', () => {
  const t = translator();
  for (let index = 0; index < 10001; index += 1)
    translated(t, call('Ringing', { id: `interaction-${String(index)}` })).commit();
  expect(translated(t, call('Ringing', { id: 'interaction-0' })).envelope.eventId).toMatch(
    /:ringing:1$/,
  );
  expect(translated(t, call('Ringing', { id: 'interaction-10000' })).envelope.eventId).toMatch(
    /:ringing:2$/,
  );
});
