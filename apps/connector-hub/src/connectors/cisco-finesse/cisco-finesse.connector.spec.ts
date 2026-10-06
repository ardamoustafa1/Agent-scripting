import { runConnectorContract } from '@verbis/sdk-connector/testing';

import { loadInvalid, loadScenario } from '../../test/scenario.js';
import { marketplaceSubject } from '../marketplace/marketplace-test.js';

import { CiscoFinesseConnector } from './cisco-finesse.connector.js';

const scenario = loadScenario(new URL('./fixtures/voice-lifecycle.json', import.meta.url));
runConnectorContract({
  ...marketplaceSubject('cisco-finesse', (deps) => new CiscoFinesseConnector(deps), [
    'verbisOutcome',
    'customerTier',
    'callVariable1',
  ]),
  commandAttributes: { callVariable1: 'sale' },
  fixtures: scenario.fixtures,
  participant: scenario.participant,
  invalidPayloads: loadInvalid(new URL('./fixtures/invalid.json', import.meta.url)),
});
