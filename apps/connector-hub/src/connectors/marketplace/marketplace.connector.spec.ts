import { describe, expect, it } from 'vitest';

import { MARKETPLACE_PROFILES, type MarketplacePlatform } from '@verbis/sdk-connector';
import { startHarness } from '@verbis/sdk-connector/testing';

import { createConnector } from '../registry.js';

import { marketplaceSubject, transports } from './marketplace-test.js';
import { type MarketplaceConnector } from './marketplace.connector.js';

const payload = (platform: MarketplacePlatform, type = 'connected', id = 'e1', extra = {}) => ({
  version: 1,
  platform,
  routingId: 'route-1',
  variables: { customerTier: 'gold', privateField: 'omit' },
  event: {
    eventId: id,
    type,
    occurredAt: '2026-10-01T10:00:00.000Z',
    platformInteractionId: 'contact-1',
    channel: 'voice',
    direction: 'inbound',
    agent: { id: 'agent-1' },
    ...extra,
  },
});
const target = { platformInteractionId: 'contact-1', commandId: 'cmd-1' };

describe('marketplace registry and security', () => {
  for (const [platform, profile] of Object.entries(MARKETPLACE_PROFILES))
    it(`registers ${platform} with an explicit kind`, () => {
      expect(
        createConnector(
          profile.type.replaceAll('-', '_'),
          { kind: profile.kind },
          { simulatorEnabled: false, marketplaceBridgeEnabled: true },
        )?.kind,
      ).toBe(profile.kind);
      expect(
        createConnector(profile.type, { kind: 'unknown' }, { simulatorEnabled: false }),
      ).toBeUndefined();
    });
  it('routes NICE skills and filters attributes and supplied campaign hints', async () => {
    const h = await startHarness(marketplaceSubject('nice-cxone'));
    await (h.connector as MarketplaceConnector).ingest(
      payload('nice-cxone', 'connected', 'e1', {
        campaignRef: { kind: 'script', externalId: 'attacker' },
        attributes: { bypass: 'no' },
      }),
    );
    expect(h.events[0]?.campaignRef).toEqual({ kind: 'skill', externalId: 'campaign-1' });
    expect(h.events[0]?.attributes).toEqual({ customerTier: 'gold' });
  });
  it('fails closed on transport loss, disagreement and expiry', async () => {
    let now = new Date('2026-10-01T10:00:00Z');
    const h = await startHarness(marketplaceSubject('salesforce'), () => now);
    await (h.connector as MarketplaceConnector).ingest(payload('salesforce'));
    const transport = transports.get(h.connector)!;
    expect(await h.connector.verifyParticipant('agent-1', 'contact-1')).toBe(true);
    transport.participant = false;
    expect(await h.connector.verifyParticipant('agent-1', 'contact-1')).toBe(false);
    transport.participant = true;
    transport.connected = false;
    expect(await h.connector.verifyParticipant('agent-1', 'contact-1')).toBe(false);
    transport.connected = true;
    now = new Date('2026-10-01T10:01:01Z');
    expect(await h.connector.verifyParticipant('agent-1', 'contact-1')).toBe(false);
  });
  it('revokes the old owner on transfer without a target and on end', async () => {
    const h = await startHarness(marketplaceSubject('dynamics-365'));
    const c = h.connector as MarketplaceConnector;
    await c.ingest(payload('dynamics-365'));
    await c.ingest(payload('dynamics-365', 'transferred', 'e2'));
    expect(await c.verifyParticipant('agent-1', 'contact-1')).toBe(false);
    await c.ingest(payload('dynamics-365', 'ended', 'e3'));
    expect(await c.verifyParticipant('agent-1', 'contact-1')).toBe(false);
    expect(await c.ingest(payload('dynamics-365', 'connected', 'e4'))).toBe(0);
  });
  it('deduplicates concurrent deliveries and command retries; rejects changed command bodies', async () => {
    const h = await startHarness(marketplaceSubject('five9'));
    const c = h.connector as MarketplaceConnector;
    await Promise.all([c.ingest(payload('five9')), c.ingest(payload('five9'))]);
    expect(h.events).toHaveLength(1);
    await Promise.all([
      c.writeAttributes(target, { verbisOutcome: 'sale' }),
      c.writeAttributes(target, { verbisOutcome: 'sale' }),
    ]);
    expect(transports.get(c)?.commands).toHaveLength(1);
    await expect(c.writeAttributes(target, { verbisOutcome: 'different' })).rejects.toMatchObject({
      code: 'command_conflict',
    });
  });
  it('does not mark failed commands as sent and rejects non-allowlisted write-back', async () => {
    const h = await startHarness(marketplaceSubject('amazon-connect'));
    const c = h.connector as MarketplaceConnector;
    await c.ingest(payload('amazon-connect'));
    const transport = transports.get(c)!;
    transport.failCommand = true;
    await expect(c.writeAttributes(target, { verbisOutcome: 'sale' })).rejects.toThrow();
    transport.failCommand = false;
    await c.writeAttributes(target, { verbisOutcome: 'sale' });
    expect(transport.commands).toHaveLength(1);
    await expect(
      c.writeAttributes({ ...target, commandId: 'c2' }, { forbidden: 'no' }),
    ).rejects.toMatchObject({ code: 'attribute_not_allowed' });
  });
  it('rejects wrong platform, unsupported channels and context mismatches without emitting', async () => {
    const h = await startHarness(marketplaceSubject('cisco-finesse'));
    const c = h.connector as MarketplaceConnector;
    await expect(c.ingest(payload('five9'))).rejects.toMatchObject({ code: 'payload_rejected' });
    await expect(
      c.ingest(payload('cisco-finesse', 'connected', 'e2', { channel: 'chat' })),
    ).rejects.toMatchObject({ code: 'payload_rejected' });
    expect(h.events).toEqual([]);
  });
});

for (const [name, profile] of Object.entries(MARKETPLACE_PROFILES)) {
  for (const channel of profile.channels) {
    it(`${name} accepts its declared ${channel} channel`, async () => {
      const platform = name as MarketplacePlatform;
      const h = await startHarness(marketplaceSubject(platform));
      await (h.connector as MarketplaceConnector).ingest(
        payload(platform, 'connected', 'event-1', { channel }),
      );
      expect(h.events[0]?.channel).toBe(channel);
    });
  }
}

it('does not approve a participant who transferred during the platform lookup', async () => {
  const h = await startHarness(marketplaceSubject('five9'));
  const c = h.connector as MarketplaceConnector;
  await c.ingest(payload('five9'));
  const transport = transports.get(c)!;
  transport.verify = async () => {
    await c.ingest(
      payload('five9', 'transferred', 'transfer-1', { transferTo: { id: 'agent-2' } }),
    );
    return true;
  };
  expect(await c.verifyParticipant('agent-1', 'contact-1')).toBe(false);
});
