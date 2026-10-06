import { readFileSync } from 'node:fs';

import type { ConnectorFixture } from '@verbis/sdk-connector/testing';

export interface Scenario {
  readonly name: string;
  readonly participant: { platformUserId: string; platformInteractionId: string };
  readonly fixtures: ConnectorFixture[];
}

/** Recorded platform payloads live next to each connector in `fixtures/*.json`. */
export function loadScenario(url: URL): Scenario {
  return JSON.parse(readFileSync(url, 'utf8')) as Scenario;
}

export function loadInvalid(url: URL): unknown[] {
  return (JSON.parse(readFileSync(url, 'utf8')) as { payload: unknown }[]).map((f) => f.payload);
}
