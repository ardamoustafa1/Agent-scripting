import { describe, expect, it } from 'vitest';

import { CommandNotSupportedError, type Connector } from '@verbis/sdk-connector';
import {
  runConnectorContract,
  startHarness,
  type ContractSubject,
} from '@verbis/sdk-connector/testing';

import { FakeSidecar, FakeWorkspacePool } from '../../test/fake-engage.js';
import { loadInvalid, loadScenario } from '../../test/scenario.js';
import { createConnector } from '../registry.js';

import { GenesysEngageConnector } from './genesys-engage.connector.js';

const common = {
  agentIdentity: 'employeeId',
  attachedData: [
    { key: 'CustomerId', variable: 'customerId' },
    { key: 'Segment', variable: 'segment', writeBack: true },
    { key: 'Balance', variable: 'balance', type: 'number' },
  ],
  disposition: { codes: { SALE: 'Sale' } },
  outbound: { callResults: { SALE: 33 } },
};
const sidecarConfig = {
  kind: 'sidecar',
  nats: { servers: ['tls://nats.acme.internal:4222'] },
  ...common,
};
const workspaceConfig = {
  kind: 'workspace',
  baseUrl: 'https://gws.acme.internal',
  authUrl: 'https://gauth.acme.internal',
  authClientId: 'verbis',
  redirectUri: 'https://acme.agent.example/api/v1/genesys-engage/oauth/callback',
  ...common,
};
const secrets = {
  natsCreds: '-----BEGIN NATS USER JWT-----\nfake-jwt-test\n------END NATS USER JWT------',
};

const sidecars = new WeakMap<Connector, FakeSidecar>();
const pools = new WeakMap<Connector, FakeWorkspacePool>();
const createSidecar = () => {
  const fake = new FakeSidecar();
  const connector = new GenesysEngageConnector('sidecar', { sidecar: fake, autoStart: false });
  sidecars.set(connector, fake);
  return connector;
};
const createWorkspace = () => {
  const pool = new FakeWorkspacePool();
  const connector = new GenesysEngageConnector('workspace', { pool, autoStart: false });
  pools.set(connector, pool);
  return connector;
};
const ingestSidecar = async (connector: Connector, payload: unknown) => {
  sidecars.get(connector)?.observe(payload);
  await (connector as GenesysEngageConnector).ingest(payload);
};
const ingestWorkspace = async (connector: Connector, payload: unknown) => {
  await (connector as GenesysEngageConnector).ingest(payload);
};
const invalid = loadInvalid(new URL('./fixtures/invalid.json', import.meta.url));
const load = (file: string) => loadScenario(new URL(`./fixtures/${file}`, import.meta.url));

for (const file of [
  'sidecar-voice.json',
  'sidecar-outbound.json',
  'sidecar-chat-transfer.json',
  'sidecar-email.json',
]) {
  const scenario = load(file);
  runConnectorContract({
    name: `genesys-engage / ${scenario.name}`,
    create: createSidecar,
    config: sidecarConfig,
    secrets,
    fixtures: scenario.fixtures,
    invalidPayloads: invalid,
    participant: scenario.participant,
    ingest: ingestSidecar,
  });
}
for (const file of ['workspace-voice.json', 'workspace-chat.json']) {
  const scenario = load(file);
  runConnectorContract({
    name: `genesys-engage / ${scenario.name}`,
    create: createWorkspace,
    config: workspaceConfig,
    secrets: {},
    fixtures: scenario.fixtures,
    invalidPayloads: invalid,
    participant: scenario.participant,
    ingest: ingestWorkspace,
  });
}

const sidecarSubject: ContractSubject = {
  name: 's',
  create: createSidecar,
  config: sidecarConfig,
  secrets,
  fixtures: [],
  invalidPayloads: [],
  participant: { platformUserId: 'x', platformInteractionId: 'y' },
  ingest: ingestSidecar,
};
const workspaceSubject: ContractSubject = {
  ...sidecarSubject,
  create: createWorkspace,
  config: workspaceConfig,
  ingest: ingestWorkspace,
};

async function replay(
  file: string,
  until: string | undefined,
  subject: ContractSubject = sidecarSubject,
) {
  const harness = await startHarness(subject);
  for (const fixture of load(file).fixtures) {
    await subject.ingest(harness.connector, fixture.payload);
    if (fixture.name === until) break;
  }
  return harness;
}

describe('genesys engage connector', () => {
  it('registers adapter genesys_engage for kinds workspace and sidecar only', () => {
    expect(
      createConnector('genesys_engage', { kind: 'sidecar' }, { simulatorEnabled: false }),
    ).toBeInstanceOf(GenesysEngageConnector);
    expect(
      createConnector('genesys-engage', { kind: 'workspace' }, { simulatorEnabled: false })?.kind,
    ).toBe('workspace');
    expect(
      createConnector('genesys_engage', { kind: 'wde' }, { simulatorEnabled: false }),
    ).toBeUndefined();
  });

  it('rejects http endpoints, plain NATS URLs with paths and duplicate variable mappings', () => {
    const schema = new GenesysEngageConnector('workspace').configSchema;
    expect(
      schema.safeParse({ ...workspaceConfig, baseUrl: 'http://gws.acme.internal' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...sidecarConfig, nats: { servers: ['nats://host:4222/x'] } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...sidecarConfig,
        attachedData: [
          { key: 'A', variable: 'v' },
          { key: 'B', variable: 'v' },
        ],
      }).success,
    ).toBe(false);
  });

  it('exposes only mapped attached data (unmapped keys such as CardNumber never become variables)', async () => {
    const harness = await replay('sidecar-voice.json', 'EventRinging');
    const attributes = harness.events[0]?.attributes ?? {};
    expect(attributes).toMatchObject({ customerId: 'C-42', segment: 'gold', balance: 1250.5 });
    expect(JSON.stringify(attributes)).not.toContain('4111111111111111');
  });

  it('writes results back: mapped writeBack keys keep their key, others get the Verbis prefix', async () => {
    const harness = await replay('sidecar-voice.json', 'EventEstablished');
    await harness.connector.writeAttributes(
      { platformInteractionId: '006d02a8b1c3f001', commandId: 'cmd-w-1' },
      { segment: 'platinum', outcome: 'sale', customerId: 'C-X', score: 9 },
    );
    const [command] = sidecars.get(harness.connector)?.commands ?? [];
    expect(command).toMatchObject({
      type: 'updateUserData',
      mediaType: 'voice',
      agent: { employeeId: 'E1001' },
      userData: {
        Segment: 'platinum',
        Verbis_outcome: 'sale',
        Verbis_customerId: 'C-X',
        Verbis_score: 9,
      },
    });
  });

  it('sets the disposition code and reports the OCS call result for outbound records', async () => {
    const harness = await replay('sidecar-outbound.json', 'outbound released');
    await harness.connector.setWrapUp(
      { platformInteractionId: '006d02a8b1c3f002', commandId: 'cmd-d-1' },
      { code: 'SALE', subCodes: ['upsell'], note: 'Yenilendi' },
    );
    const commands = sidecars.get(harness.connector)?.commands ?? [];
    expect(commands[0]).toMatchObject({
      type: 'updateUserData',
      userData: { DispositionCode: 'Sale', Verbis_Note: '[upsell] Yenilendi' },
    });
    expect(commands[1]).toMatchObject({
      type: 'ocsRecordProcessed',
      recordHandle: 77,
      callResult: 33,
      campaignName: 'Renewal_Q4',
      applicationId: 118,
      final: true,
    });
  });

  it('inbound disposition sends no OCS feedback; unknown interactions are refused', async () => {
    const harness = await replay('sidecar-voice.json', 'EventReleased (ACW)');
    await harness.connector.setWrapUp(
      { platformInteractionId: '006d02a8b1c3f001', commandId: 'cmd-d-2' },
      { code: 'NO_SALE', subCodes: [] },
    );
    const commands = sidecars.get(harness.connector)?.commands ?? [];
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ userData: { DispositionCode: 'NO_SALE' } });
    await expect(
      harness.connector.setWrapUp(
        { platformInteractionId: 'nope', commandId: 'cmd-d-3' },
        { code: 'X', subCodes: [] },
      ),
    ).rejects.toThrow();
  });

  it('recording control is not supported (no WDE, no T-Server recording API)', async () => {
    const harness = await replay('sidecar-voice.json', 'EventEstablished');
    await expect(
      harness.connector.pauseRecording({
        platformInteractionId: '006d02a8b1c3f001',
        commandId: 'c',
      }),
    ).rejects.toBeInstanceOf(CommandNotSupportedError);
  });

  it('s2s verification needs both the event stream and the sidecar to agree', async () => {
    const harness = await replay('sidecar-voice.json', 'EventEstablished');
    const fake = sidecars.get(harness.connector);
    expect(await harness.connector.verifyParticipant('E1001', '006d02a8b1c3f001')).toBe(true);
    fake?.owners.set('006d02a8b1c3f001', { agent: 'E9999', live: true });
    expect(await harness.connector.verifyParticipant('E1001', '006d02a8b1c3f001')).toBe(false);
  });

  it('workspace mode: commands go through the agent’s own session with Workspace API paths', async () => {
    const harness = await replay('workspace-voice.json', 'Released', workspaceSubject);
    await harness.connector.writeAttributes(
      { platformInteractionId: '006d02a8b1c3f0aa', commandId: 'cmd-ws-1' },
      { outcome: 'ok' },
    );
    await harness.connector.setWrapUp(
      { platformInteractionId: '006d02a8b1c3f0aa', commandId: 'cmd-ws-2' },
      { code: 'SALE', subCodes: [] },
    );
    const requests = pools.get(harness.connector)?.requests ?? [];
    expect(requests.map((r) => [r.agentRef, r.path])).toEqual([
      ['E1001', '/workspace/v3/voice/calls/006d02a8b1c3f0aa/update-user-data'],
      ['E1001', '/workspace/v3/voice/calls/006d02a8b1c3f0aa/update-user-data'],
    ]);
    expect(requests[1]?.body).toEqual({
      data: { userData: [{ key: 'DispositionCode', type: 'str', value: 'Sale' }] },
    });
  });

  it('workspace mode: chat write-back uses the media path; a disconnected session fails verification', async () => {
    const harness = await replay('workspace-chat.json', 'chat Accepted', workspaceSubject);
    await harness.connector.writeAttributes(
      { platformInteractionId: '0001KaC9WYKH3W01', commandId: 'cmd-ws-3' },
      { outcome: 'ok' },
    );
    const pool = pools.get(harness.connector);
    expect(pool?.requests[0]?.path).toBe(
      '/workspace/v3/media/chat/interactions/0001KaC9WYKH3W01/update-user-data',
    );
    expect(await harness.connector.verifyParticipant('E1001', '0001KaC9WYKH3W01')).toBe(true);
    pool?.connectedAgents.delete('E1001');
    expect(await harness.connector.verifyParticipant('E1001', '0001KaC9WYKH3W01')).toBe(false);
  });

  it('workspace mode: backpressure retries keep the same event id', async () => {
    const harness = await startHarness(workspaceSubject);
    const [first] = load('workspace-voice.json').fixtures;
    harness.setBackpressure(true);
    await expect(ingestWorkspace(harness.connector, first?.payload)).rejects.toThrow();
    harness.setBackpressure(false);
    await ingestWorkspace(harness.connector, first?.payload);
    expect(harness.events[0]?.eventId).toBe('ws:E1001:006d02a8b1c3f0aa:ringing:1');
  });

  it('workspace mode needs an agent token source', async () => {
    await expect(
      startHarness({
        ...workspaceSubject,
        create: () => new GenesysEngageConnector('workspace', { autoStart: false }),
      }),
    ).rejects.toThrow();
  });
});
