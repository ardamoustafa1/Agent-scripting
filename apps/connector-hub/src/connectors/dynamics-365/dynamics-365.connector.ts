import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class Dynamics365Connector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('dynamics-365', deps);
  }
}
