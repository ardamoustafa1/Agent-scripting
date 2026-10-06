import { describe, expect, it } from 'vitest';

import { CommandNotSupportedError, type Connector } from '@verbis/sdk-connector';
import { runConnectorContract, startHarness } from '@verbis/sdk-connector/testing';

import { FakeAvayaSidecar, fakeRecorder } from '../../test/fake-avaya.js';
import { loadInvalid, loadScenario } from '../../test/scenario.js';
import { createConnector } from '../registry.js';

import { AvayaSidecarConnector } from './avaya-sidecar.connector.js';

const config = {
  kind: 'sidecar',
  nats: { servers: ['tls://nats.acme.internal:4222'] },
  agentIdentity: 'loginId',
  uui: { format: 'kv', allow: ['cust', 'seg'] },
  intrinsics: ['CustomerId', 'Priority'],
  dispositionCodes: { SALE: '101' },
  outbound: { completionCodes: { SALE: 'SALE_OK' }, fields: ['firstName', 'balance'] },
  recording: { url: 'https://recorder.acme.internal/verbis' },
};
const secrets = { natsCreds: 'fake-nats-creds-test', recorderSecret: 'rec-secret-test' };
const sidecars = new WeakMap<Connector, FakeAvayaSidecar>();
const recorder = fakeRecorder();
const factory = (type: 'avaya-aes' | 'avaya-aacc') => () => {
  const fake = new FakeAvayaSidecar();
  const connector = new AvayaSidecarConnector(type, {
    sidecar: fake,
    autoStart: false,
    fetch: recorder.fetchImpl,
  });
  sidecars.set(connector, fake);
  return connector;
};
const ingest = async (connector: Connector, payload: unknown) => {
  sidecars.get(connector)?.observe(payload);
  await (connector as AvayaSidecarConnector).ingest(payload);
};
const invalid = loadInvalid(new URL('./fixtures/invalid.json', import.meta.url));
const load = (file: string) => loadScenario(new URL(`./fixtures/${file}`, import.meta.url));

for (const [type, files] of [
  ['avaya-aes', ['aes-inbound.json', 'aes-outbound-pom.json']],
  ['avaya-aacc', ['aacc-email.json', 'aacc-chat.json']],
] as const)
  for (const file of files) {
    const scenario = load(file);
    runConnectorContract({
      name: `${type} / ${scenario.name}`,
      create: factory(type),
      config,
      secrets,
      fixtures: scenario.fixtures,
      invalidPayloads: invalid,
      participant: scenario.participant,
      ingest,
    });
  }

const subject = (type: 'avaya-aes' | 'avaya-aacc') => ({
  name: type,
  create: factory(type),
  config,
  secrets,
  fixtures: [],
  invalidPayloads: [],
  participant: { platformUserId: 'x', platformInteractionId: 'y' },
  ingest,
});
async function replay(type: 'avaya-aes' | 'avaya-aacc', file: string, until?: string) {
  const harness = await startHarness(subject(type));
  for (const fixture of load(file).fixtures) {
    await ingest(harness.connector, fixture.payload);
    if (fixture.name === until) break;
  }
  return { harness, fake: sidecars.get(harness.connector) };
}
const UCID = '00001002011696172345';

describe('avaya sidecar connectors (AES, AACC)', () => {
  it('registers avaya_aes / avaya_aacc with kind sidecar', () => {
    expect(
      createConnector('avaya_aes', { kind: 'sidecar' }, { simulatorEnabled: false })?.type,
    ).toBe('avaya-aes');
    expect(
      createConnector('avaya-aacc', { kind: 'sidecar' }, { simulatorEnabled: false })?.type,
    ).toBe('avaya-aacc');
    expect(
      createConnector('avaya_aes', { kind: 'dmcc' }, { simulatorEnabled: false }),
    ).toBeUndefined();
  });

  it('AES: only allow-listed UUI keys become variables (the PIN never does)', async () => {
    const { harness } = await replay(
      'avaya-aes',
      'aes-inbound.json',
      'CallCtlConnDeliveredEv (VDN 7001, skill 21, UUI)',
    );
    expect(harness.events[0]?.attributes).toMatchObject({ 'uui.cust': 'C-42', 'uui.seg': 'gold' });
    expect(JSON.stringify(harness.events[0]?.attributes)).not.toContain('1234');
  });

  it('AES: refuses envelopes from AACC and cannot write data into a live call', async () => {
    const { harness } = await replay('avaya-aes', 'aes-inbound.json', 'established');
    const aacc = load('aacc-email.json').fixtures[0]?.payload;
    await expect((harness.connector as AvayaSidecarConnector).ingest(aacc)).rejects.toMatchObject({
      code: 'avaya_wrong_source',
    });
    await expect(
      harness.connector.writeAttributes(
        { platformInteractionId: UCID, commandId: 'c1' },
        { a: 'b' },
      ),
    ).rejects.toBeInstanceOf(CommandNotSupportedError);
  });

  it('AES: POM outbound wrap-up sends the mapped completion code to the sidecar', async () => {
    const { harness, fake } = await replay(
      'avaya-aes',
      'aes-outbound-pom.json',
      'POM cleared (no ACW)',
    );
    await harness.connector.setWrapUp(
      { platformInteractionId: '00001002011696179999', commandId: 'cmd-1' },
      { code: 'SALE', subCodes: [] },
    );
    expect(fake?.commands).toEqual([
      expect.objectContaining({
        type: 'outboundResult',
        system: 'pom',
        campaign: 'Renewal_Q4',
        recordId: '98765',
        completionCode: 'SALE_OK',
        agent: { loginId: '3001', extension: '4001' },
      }),
    ]);
  });

  it('AES: inbound wrap-up tags the recording; secure pause/resume go to the recorder by UCID', async () => {
    recorder.calls.length = 0;
    const { harness } = await replay('avaya-aes', 'aes-inbound.json', 'cleared into ACW');
    await harness.connector.setWrapUp(
      { platformInteractionId: UCID, commandId: 'cmd-2' },
      { code: 'NO_SALE', subCodes: [] },
    );
    await harness.connector.pauseRecording({ platformInteractionId: UCID, commandId: 'cmd-3' });
    await harness.connector.resumeRecording({ platformInteractionId: UCID, commandId: 'cmd-4' });
    expect(recorder.calls.map((c) => [c.body['action'], c.body['call']])).toEqual([
      ['tag', UCID],
      ['pause', UCID],
      ['resume', UCID],
    ]);
    expect(recorder.calls[0]?.body['tags']).toEqual({ outcome: 'NO_SALE' });
  });

  it('AACC: intrinsics allow-list, write-back and disposition (closed reason) through CCMM', async () => {
    const { harness, fake } = await replay('avaya-aacc', 'aacc-email.json', 'email accepted');
    expect(harness.events[0]?.attributes).not.toHaveProperty('intrinsic.CardNo');
    await harness.connector.writeAttributes(
      { platformInteractionId: '1000123', commandId: 'cmd-5' },
      { outcome: 'refund', amount: 120 },
    );
    await harness.connector.setWrapUp(
      { platformInteractionId: '1000123', commandId: 'cmd-6' },
      { code: 'SALE', subCodes: ['refund'], note: 'İade' },
    );
    expect(fake?.commands).toEqual([
      expect.objectContaining({
        type: 'setIntrinsics',
        intrinsics: { outcome: 'refund', amount: '120' },
      }),
      expect.objectContaining({
        type: 'disposition',
        mediaType: 'email',
        code: '101',
        note: '[refund] İade',
      }),
    ]);
  });

  it('s2s verification requires the sidecar to agree with the event stream', async () => {
    const { harness, fake } = await replay('avaya-aes', 'aes-inbound.json', 'established');
    expect(await harness.connector.verifyParticipant('3001', UCID)).toBe(true);
    fake?.owners.set(UCID, { agent: '3999', live: true });
    expect(await harness.connector.verifyParticipant('3001', UCID)).toBe(false);
  });
});
