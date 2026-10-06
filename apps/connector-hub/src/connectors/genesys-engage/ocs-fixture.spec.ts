import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EngageCommandSchema } from './envelope.js';
import { ocsUserData } from './ocs.js';

const hubPath = new URL('./fixtures/ocs-userdata.json', import.meta.url);
const sidecarPath = new URL(
  '../../../../connector-genesys-engage-sidecar/src/test/resources/fixtures/ocs-userdata.json',
  import.meta.url,
);
interface Fixture {
  cases: { name: string; command: unknown; expectedUserData: Record<string, string | number> }[];
}
const fixture = JSON.parse(readFileSync(hubPath, 'utf8')) as Fixture;

describe('OCS user data contract (M-27, unverified against a live OCS)', () => {
  it('stays identical to the sidecar copy so both sides assert the same wire contract', () => {
    expect(readFileSync(hubPath, 'utf8')).toBe(readFileSync(sidecarPath, 'utf8'));
  });
  for (const testCase of fixture.cases)
    it(`maps ${testCase.name}`, () => {
      const command = EngageCommandSchema.parse(testCase.command);
      if (command.type !== 'ocsRecordProcessed') throw new Error('fixture must be OCS');
      expect(ocsUserData(command)).toEqual(testCase.expectedUserData);
    });
});
