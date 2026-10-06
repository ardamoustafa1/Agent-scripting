import { describe, expect, it, vi } from 'vitest';

import { LaunchPorts } from '../launch/launch-ports.js';

import { HubPlatformVerifier } from './hub-platform-verifier.js';

import type { HubClient } from './hub-client.js';

function fixture() {
  const call = vi.fn().mockResolvedValue({ verified: true });
  const ports = new LaunchPorts();
  new HubPlatformVerifier({ configured: true, call } as unknown as HubClient, ports).onModuleInit();
  return { ports, call };
}
const interaction = {
  tenantId: 'tenant',
  connectorId: 'connector',
  externalId: 'conversation',
  platform: 'GENESYS_CLOUD',
};
describe('hub platform verification identity', () => {
  it('passes the authenticated event identity for email/externalId matched agents and re-verifies with the hub', async () => {
    const f = fixture();
    await f.ports.verify({ ...interaction, ctiIdentities: [], platformUserId: 'event-agent' });
    expect(f.call).toHaveBeenCalledWith(
      'tenant',
      'POST',
      '/internal/v1/connectors/connector/verify-participant',
      expect.anything(),
      { platformUserIds: ['event-agent'], platformInteractionId: 'conversation' },
    );
    f.call.mockResolvedValueOnce({ verified: false });
    await expect(
      f.ports.verify({ ...interaction, ctiIdentities: [], platformUserId: 'event-agent' }),
    ).rejects.toThrow();
  });
  it('normalizes legacy identities, filters other platforms and prefers the matched event id', async () => {
    const f = fixture();
    const ctiIdentities = [
      { platform: 'genesys-cloud', platformUserId: 'legacy-agent' },
      { platform: 'avaya', id: 'foreign-agent' },
    ];
    await f.ports.verify({ ...interaction, ctiIdentities });
    expect(f.call.mock.calls[0]?.[4]).toMatchObject({ platformUserIds: ['legacy-agent'] });
    await f.ports.verify({ ...interaction, ctiIdentities, platformUserId: 'transferred-agent' });
    expect(f.call.mock.calls[1]?.[4]).toMatchObject({ platformUserIds: ['transferred-agent'] });
  });
  it('fails closed with no mapped identity and no applicable stored identity', async () => {
    const f = fixture();
    await expect(
      f.ports.verify({ ...interaction, ctiIdentities: [{ platform: 'avaya', id: 'foreign' }] }),
    ).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
  });
});
