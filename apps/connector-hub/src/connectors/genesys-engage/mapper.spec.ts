import { describe, expect, it } from 'vitest';

import { mapPlatformEvent } from '@verbis/sdk-connector';

import { GenesysEngageConfigSchema } from './config.js';
import { agentKey, channelOf, createEngageMapper, recordHandleOf } from './mapper.js';

const config = GenesysEngageConfigSchema.parse({
  kind: 'sidecar',
  nats: { servers: ['tls://nats:4222'] },
  agentIdentity: 'userName',
  attachedData: [
    { key: 'VIP', variable: 'vip', type: 'boolean' },
    { key: 'Score', variable: 'score', type: 'number' },
  ],
  disposition: { requireAfterCall: false },
});
const mapper = createEngageMapper(() => config);
const base = {
  schema: 'verbis.engage.envelope.v1',
  eventId: 'TServer:1',
  source: 'tserver',
  occurredAt: '2026-10-01T10:00:00.000Z',
  interactionId: '006d02a8b1c3f001',
  mediaType: 'voice',
  agent: { employeeId: 'E1', userName: 'ayse.k' },
};

describe('genesys engage mapper', () => {
  it('maps media types to channels', () => {
    expect(
      ['voice', 'chat', 'webchat', 'email', 'sms', 'whatsapp', 'facebook', 'workitem'].map((m) =>
        channelOf(m as never),
      ),
    ).toEqual(['voice', 'chat', 'chat', 'email', 'sms', 'whatsapp', 'social', 'chat']);
  });

  it('uses the configured agent identity and coerces mapped types', () => {
    const [event] = mapPlatformEvent(mapper, {
      ...base,
      event: 'ringing',
      userData: { VIP: 'Y', Score: 'abc' },
    });
    expect(event?.agent).toEqual({ id: 'ayse.k' });
    expect(event?.attributes).toMatchObject({ vip: true, score: null });
    expect(agentKey({ employeeId: '' }, 'employeeId')).toBeUndefined();
  });

  it('released ends the interaction when no after-call disposition is required; attached-data changes are ignored', () => {
    expect(mapPlatformEvent(mapper, { ...base, event: 'released' })[0]?.type).toBe('ended');
    expect(mapPlatformEvent(mapper, { ...base, event: 'attachedDataChanged' })).toEqual([]);
  });

  it('reads OCS record handles defensively', () => {
    expect(recordHandleOf({ userData: { GSW_RECORD_HANDLE: '12' } })).toBe(12);
    expect(recordHandleOf({ userData: { GSW_RECORD_HANDLE: '1e3' } })).toBeUndefined();
    expect(recordHandleOf({ userData: {} })).toBeUndefined();
  });
});
