import {
  MarketplaceConnector,
  type MarketplaceDeps,
} from '../marketplace/marketplace.connector.js';

export class TwilioFlexConnector extends MarketplaceConnector {
  constructor(deps: MarketplaceDeps = {}) {
    super('twilio-flex', deps);
  }
}
