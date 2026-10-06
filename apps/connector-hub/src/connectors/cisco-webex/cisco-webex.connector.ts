import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class CiscoWebexConnector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('cisco-webex', deps);
  }
}
