import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class NiceCxoneConnector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('nice-cxone', deps);
  }
}
