import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class SalesforceConnector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('salesforce', deps);
  }
}
