import { runConnectorContract } from '@verbis/sdk-connector/testing';

import { loadInvalid, loadScenario } from '../../test/scenario.js';
import { marketplaceSubject } from '../marketplace/marketplace-test.js';

import { TwilioFlexConnector } from './twilio-flex.connector.js';

const scenario = loadScenario(new URL('./fixtures/voice-lifecycle.json', import.meta.url));
runConnectorContract({
  ...marketplaceSubject('twilio-flex', (deps) => new TwilioFlexConnector(deps)),
  fixtures: scenario.fixtures,
  participant: scenario.participant,
  invalidPayloads: loadInvalid(new URL('./fixtures/invalid.json', import.meta.url)),
});
