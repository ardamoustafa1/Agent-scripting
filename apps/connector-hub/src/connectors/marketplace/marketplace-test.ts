import type { Connector, MarketplacePlatform } from '@verbis/sdk-connector';
import { MARKETPLACE_PROFILES } from '@verbis/sdk-connector';
import type { ContractSubject } from '@verbis/sdk-connector/testing';

import { MarketplaceConnector, type MarketplaceDeps } from './marketplace.connector.js';

import type { SidecarCommand, SidecarTransport } from '../shared/nats-sidecar-transport.js';

export class FakeMarketplaceTransport implements SidecarTransport {
  connected = true;
  readonly commands: SidecarCommand[] = [];
  participant = true;
  failCommand = false;
  start(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }
  send(command: SidecarCommand): Promise<void> {
    if (this.failCommand) return Promise.reject(new Error('vendor unavailable'));
    this.commands.push(command);
    return Promise.resolve();
  }
  verify(): Promise<boolean> {
    return Promise.resolve(this.participant);
  }
}
export const transports = new WeakMap<Connector, FakeMarketplaceTransport>();
export function marketplaceSubject(
  platform: MarketplacePlatform,
  create = (deps: MarketplaceDeps) => new MarketplaceConnector(platform, deps),
): ContractSubject {
  return {
    name: platform,
    create: () => {
      const transport = new FakeMarketplaceTransport();
      const connector = create({ transport, autoStart: false });
      transports.set(connector, transport);
      return connector;
    },
    config: {
      kind: MARKETPLACE_PROFILES[platform].kind,
      nats: { servers: ['tls://nats.example.test:4222'] },
      attributeAllowList: ['verbisOutcome', 'customerTier'],
      routing: { 'route-1': 'campaign-1' },
    },
    secrets: { natsCreds: 'fixture-only-credentials' },
    fixtures: [],
    invalidPayloads: [],
    participant: { platformUserId: 'agent-1', platformInteractionId: 'contact-1' },
    ingest: async (connector, payload) => {
      await (connector as MarketplaceConnector).ingest(payload);
    },
  };
}
