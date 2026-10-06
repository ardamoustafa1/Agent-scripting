import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class Five9Connector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('five9', deps);
  }
}
