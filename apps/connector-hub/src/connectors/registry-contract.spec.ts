import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ADAPTER_TYPES, MARKETPLACE_PROFILES, validateCapabilities } from '@verbis/sdk-connector';

import { createConnector } from './registry.js';

const native = [
  ['generic', 'webhook', 'generic-webhook/generic-webhook.connector.spec.ts'],
  ['generic', 'simulator', 'simulator/simulator.connector.spec.ts'],
  ['genesys-cloud', 'cloud', 'genesys-cloud/genesys-cloud.connector.spec.ts'],
  ['genesys-engage', 'sidecar', 'genesys-engage/genesys-engage.connector.spec.ts'],
  ['genesys-engage', 'workspace', 'genesys-engage/genesys-engage.connector.spec.ts'],
  ['avaya-aes', 'sidecar', 'avaya/avaya-sidecar.connector.spec.ts'],
  ['avaya-aacc', 'sidecar', 'avaya/avaya-sidecar.connector.spec.ts'],
  ['avaya-axp', 'workspaces', 'avaya/axp/axp.connector.spec.ts'],
] as const;
const marketplace = Object.entries(MARKETPLACE_PROFILES).map(
  ([name, profile]) => [profile.type, profile.kind, `${name}/${name}.connector.spec.ts`] as const,
);
const inventory = [...native, ...marketplace];
describe('every registered connector has the shared contract', () => {
  it('covers every declared adapter type', () => {
    expect([...new Set(inventory.map(([type]) => type))].sort()).toEqual([...ADAPTER_TYPES].sort());
  });
  for (const [type, kind, file] of inventory)
    it(`${type}/${kind} has a valid factory and contract entry point`, () => {
      const connector = createConnector(type, { kind }, { simulatorEnabled: true });
      expect(connector).toBeDefined();
      expect(connector?.kind).toBe(kind);
      expect(validateCapabilities(connector!.capabilities)).toEqual([]);
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).toMatch(
        /\brunConnectorContract\s*\(/,
      );
      expect(
        createConnector(type, { kind: 'unregistered-kind' }, { simulatorEnabled: true }),
      ).toBeUndefined();
    });
  it('does not activate a simulator when disabled', () => {
    expect(
      createConnector('generic', { kind: 'simulator' }, { simulatorEnabled: false }),
    ).toBeUndefined();
  });
});
