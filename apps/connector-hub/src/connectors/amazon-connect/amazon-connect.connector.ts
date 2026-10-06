import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class AmazonConnectConnector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('amazon-connect', deps);
  }
}
