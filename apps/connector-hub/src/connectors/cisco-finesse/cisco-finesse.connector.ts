import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class CiscoFinesseConnector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('cisco-finesse', deps);
  }
}
