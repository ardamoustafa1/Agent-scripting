import { describe, expect, it } from 'vitest';

import { CommandNotSupportedError, type Connector } from '@verbis/sdk-connector';
import { runConnectorContract, startHarness } from '@verbis/sdk-connector/testing';

import { FakeAxp } from '../../../test/fake-avaya.js';
import { loadInvalid, loadScenario } from '../../../test/scenario.js';
import { createConnector } from '../../registry.js';

import { isAvayaWss } from './axp-notifications.js';
import { AxpConnector } from './axp.connector.js';
import { AxpEndpointsSchema } from './endpoints.js';

const config = {
  kind: 'workspaces',
  host: 'na.api.avayacloud.com',
  accountId: 'ACME01',
  dispositionCodes: { SALE: 'Resolved' },
  recording: { url: 'https://recorder.acme.internal/verbis' },
};
const secrets = {
  clientId: 'axp-client-test',
  clientSecret: 'axp-secret-test-0001',
  appKey: 'axp-appkey-test-0002',
  recorderSecret: 'rec-secret-test',
};
const fakes = new WeakMap<Connector, FakeAxp>();
const WRAPUP_ENDPOINTS = AxpEndpointsSchema.parse({
  wrapUpMode: 'rest',
  wrapUpPath: '/api/interactions/v1/accounts/{accountId}/interactions/{interactionId}/wrapup',
});
const create = () => {
  const fake = new FakeAxp();
  const connector = new AxpConnector({
    endpoints: WRAPUP_ENDPOINTS,
    fetch: fake.fetch,
    socket: null,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  fakes.set(connector, fake);
  return connector;
};
const ingest = async (connector: Connector, payload: unknown) => {
  fakes.get(connector)?.observe(payload);
  await (connector as AxpConnector).ingest(payload);
};
const invalid = loadInvalid(new URL('../fixtures/axp-invalid.json', import.meta.url));
const load = (file: string) => loadScenario(new URL(`../fixtures/${file}`, import.meta.url));

for (const file of ['axp-voice.json', 'axp-chat.json']) {
  const scenario = load(file);
  runConnectorContract({
    name: `avaya-axp / ${scenario.name}`,
    create,
    config,
    secrets,
    fixtures: scenario.fixtures,
    invalidPayloads: invalid,
    participant: scenario.participant,
    ingest,
  });
}

const subject = {
  name: 'axp',
  create,
  config,
  secrets,
  fixtures: [],
  invalidPayloads: [],
  participant: { platformUserId: 'x', platformInteractionId: 'y' },
  ingest,
};
const ENG = 'bffae854-9219-4cfc-9fd3-7125f2e76844';
async function replay(file: string, until: string) {
  const harness = await startHarness(subject);
  for (const fixture of load(file).fixtures) {
    await ingest(harness.connector, fixture.payload);
    if (fixture.name === until) break;
  }
  return { harness, fake: fakes.get(harness.connector) };
}

describe('avaya experience platform connector', () => {
  it('registers avaya_axp / kind workspaces and pins hosts to avayacloud.com', () => {
    expect(
      createConnector('avaya_axp', { kind: 'workspaces' }, { simulatorEnabled: false }),
    ).toBeInstanceOf(AxpConnector);
    const schema = new AxpConnector().configSchema;
    expect(schema.safeParse({ ...config, host: 'evil.example' }).success).toBe(false);
    expect(
      schema.safeParse({ ...config, host: 'na.api.avayacloud.com.evil.example' }).success,
    ).toBe(false);
    expect(isAvayaWss('wss://na.api.avayacloud.com/notification/ws')).toBe(true);
    expect(isAvayaWss('wss://evil.example/ws')).toBe(false);
  });

  it('verifies the widget interaction with the Engagement API (client credentials + appkey, no cache)', async () => {
    const { harness, fake } = await replay('axp-voice.json', 'AgentParticipant ADDED');
    expect(await harness.connector.verifyParticipant('ayse.k', ENG)).toBe(true);
    expect(await harness.connector.verifyParticipant('ayse.k', ENG)).toBe(true);
    expect(await harness.connector.verifyParticipant('mehmet.y', ENG)).toBe(false);
    expect(await harness.connector.verifyParticipant('ayse.k', '../../x')).toBe(false);
    const gets = fake?.calls.filter((c) => c.method === 'GET') ?? [];
    expect(gets).toHaveLength(3);
    expect(gets[0]?.headers.get('appkey')).toBe('axp-appkey-test-0002');
    expect(gets[0]?.headers.get('authorization')).toBe('Bearer axp-token-1');
    const token = fake?.calls.find((c) =>
      c.url.endsWith('/auth/realms/ACME01/protocol/openid-connect/token'),
    );
    expect(new URLSearchParams(String(token?.body)).get('grant_type')).toBe('client_credentials');
  });

  it('only invited (not yet connected) agents are refused unless verifyInvited', async () => {
    const { harness } = await replay('axp-voice.json', 'MatchOffered');
    expect(await harness.connector.verifyParticipant('ayse.k', ENG)).toBe(false);
  });

  it('propagates outages so the hub fails closed', async () => {
    const { harness, fake } = await replay('axp-voice.json', 'AgentParticipant ADDED');
    if (fake !== undefined) fake.failNext = 400;
    await expect(harness.connector.verifyParticipant('ayse.k', ENG)).rejects.toThrow();
  });

  it('wraps up with the mapped disposition code and notes', async () => {
    const { harness, fake } = await replay('axp-voice.json', 'AgentParticipant REMOVED (ACW)');
    await harness.connector.setWrapUp(
      { platformInteractionId: ENG, commandId: 'cmd-1' },
      { code: 'SALE', subCodes: ['upsell'], note: 'Paket' },
    );
    const post = fake?.calls.find((c) => c.method === 'POST' && c.url.endsWith('/wrapup'));
    expect(post?.url).toContain(`/api/interactions/v1/accounts/ACME01/interactions/${ENG}/wrapup`);
    expect(post?.body).toEqual({ dispositionCode: 'Resolved', notes: '[upsell] Paket' });
    await expect(
      harness.connector.writeAttributes(
        { platformInteractionId: ENG, commandId: 'w1' },
        { a: 'b' },
      ),
    ).rejects.toBeInstanceOf(CommandNotSupportedError);
  });

  it('refuses wrap-up by default (REST endpoint unverified) and does not advertise it', async () => {
    const harness = await startHarness({
      ...subject,
      create: () => new AxpConnector({ fetch: new FakeAxp().fetch, socket: null }),
    });
    expect(harness.connector.capabilities.features).not.toContain('wrapUpCodes');
    await expect(
      harness.connector.setWrapUp(
        { platformInteractionId: ENG, commandId: 'cmd-1' },
        { code: 'SALE', subCodes: [] },
      ),
    ).rejects.toBeInstanceOf(CommandNotSupportedError);
  });

  it('wraps up on the configured REST path and token path when explicitly enabled', async () => {
    const fake = new FakeAxp();
    const connector = new AxpConnector({
      fetch: fake.fetch,
      socket: null,
      endpoints: AxpEndpointsSchema.parse({
        tokenPath: '/api/auth/v1/{accountId}/protocol/openid-connect/token',
        wrapUpMode: 'rest',
        wrapUpPath: '/api/custom/{accountId}/{interactionId}/done',
      }),
    });
    expect(connector.capabilities.features).toContain('wrapUpCodes');
    fakes.set(connector, fake);
    const harness = await startHarness({ ...subject, create: () => connector });
    for (const fixture of load('axp-voice.json').fixtures) {
      fake.observe(fixture.payload);
      await (harness.connector as AxpConnector).ingest(fixture.payload);
      if (fixture.name === 'AgentParticipant REMOVED (ACW)') break;
    }
    await harness.connector.setWrapUp(
      { platformInteractionId: ENG, commandId: 'cmd-9' },
      { code: 'SALE', subCodes: [] },
    );
    expect(fake.calls.some((c) => c.url.endsWith(`/api/custom/ACME01/${ENG}/done`))).toBe(true);
    expect(
      fake.calls.some((c) => c.url.endsWith('/api/auth/v1/ACME01/protocol/openid-connect/token')),
    ).toBe(true);
  });

  it('secure pause goes to the recording system for voice, is a no-op for chat', async () => {
    const voice = await replay('axp-voice.json', 'AgentParticipant ADDED');
    await voice.harness.connector.pauseRecording({ platformInteractionId: ENG, commandId: 'p1' });
    expect(voice.fake?.calls.some((c) => c.url === 'https://recorder.acme.internal/verbis')).toBe(
      true,
    );
    const chat = await replay('axp-chat.json', 'chat ADDED');
    await chat.harness.connector.pauseRecording({
      platformInteractionId: '0c1d2e3f-4a5b-4c6d-8e9f-a0b1c2d3e4f5',
      commandId: 'p2',
    });
    expect(chat.fake?.calls.some((c) => c.url.includes('recorder'))).toBe(false);
  });
});
