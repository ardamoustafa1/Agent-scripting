import { z } from 'zod';

import {
  MARKETPLACE_PROFILES,
  type MarketplacePlatform,
  type Connector,
  type ConnectorContext,
} from '@verbis/sdk-connector';

import { AvayaSidecarConnector } from './avaya/avaya-sidecar.connector.js';
import { AxpConnector } from './avaya/axp/axp.connector.js';
import { type AxpEndpoints } from './avaya/axp/endpoints.js';
import { GenericWebhookConnector } from './generic-webhook/generic-webhook.connector.js';
import { GenesysCloudConnector } from './genesys-cloud/genesys-cloud.connector.js';
import { GenesysEngageConnector } from './genesys-engage/genesys-engage.connector.js';
import { MarketplaceConnector } from './marketplace/marketplace.connector.js';
import { SimulatorConnector } from './simulator/simulator.connector.js';

import type { AgentTokenSource } from './genesys-engage/workspace/workspace-session.js';

export interface RegistryOptions {
  readonly simulatorEnabled: boolean;
  /**
   * Marketplace adapters (Amazon Connect, Cisco, NICE, Five9, Flex, Salesforce, Dynamics) only
   * relay envelopes published by an external vendor bridge, which this repository does not ship.
   * Off unless an operator deploys such a bridge (HUB_MARKETPLACE_BRIDGE_ENABLED).
   */
  readonly marketplaceBridgeEnabled?: boolean;
  /** Delegated Genesys Engage agent tokens (workspace mode), bound to the tenant by the supervisor. */
  /** AXP token path / REST wrap-up (explicit operator config, audit M-25). */
  readonly axp?: AxpEndpoints;
  readonly engageAgentTokens?: (ctx: ConnectorContext) => AgentTokenSource;
}

const KindSchema = z.object({ kind: z.string() });

/**
 * Connector factories by API adapter type (`genesys_cloud` or `genesys-cloud`) + `config.kind`.
 * Marketplace desktop and server bridge adapters are registered by their explicit kind.
 */
export function createConnector(
  adapterType: string,
  config: unknown,
  options: RegistryOptions,
): Connector | undefined {
  const kind = KindSchema.safeParse(config).data?.kind;
  if (adapterType === 'generic' && kind === 'webhook') return new GenericWebhookConnector();
  if (adapterType === 'generic' && kind === 'simulator' && options.simulatorEnabled)
    return new SimulatorConnector();
  if (adapterType.replaceAll('_', '-') === 'genesys-cloud' && kind === 'cloud')
    return new GenesysCloudConnector();
  if (
    adapterType.replaceAll('_', '-') === 'genesys-engage' &&
    (kind === 'workspace' || kind === 'sidecar')
  )
    return new GenesysEngageConnector(
      kind,
      options.engageAgentTokens === undefined ? {} : { agentTokens: options.engageAgentTokens },
    );
  const avaya = adapterType.replaceAll('_', '-');
  if ((avaya === 'avaya-aes' || avaya === 'avaya-aacc') && kind === 'sidecar')
    return new AvayaSidecarConnector(avaya);
  if (avaya === 'avaya-axp' && kind === 'workspaces')
    return new AxpConnector(options.axp === undefined ? {} : { endpoints: options.axp });
  if (options.marketplaceBridgeEnabled !== true) return undefined;
  for (const [platform, profile] of Object.entries(MARKETPLACE_PROFILES))
    if (adapterType.replaceAll('_', '-') === profile.type && kind === profile.kind)
      return new MarketplaceConnector(platform as MarketplacePlatform);
  return undefined;
}
