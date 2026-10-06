import { describe, expect, it, vi } from 'vitest';

import { BackpressureError, ConnectorError, type Connector } from '@verbis/sdk-connector';
import { runConnectorContract, startHarness } from '@verbis/sdk-connector/testing';

import { FakeGenesys } from '../../test/fake-genesys.js';
import { loadInvalid, loadScenario } from '../../test/scenario.js';
import { createConnector } from '../registry.js';

import { GenesysCloudConnector } from './genesys-cloud.connector.js';

const QUEUE = '0f0c2a1e-0000-4000-8000-000000000201';
const AGENT_A = '0f0c2a1e-0000-4000-8000-000000000101';
const SALE = '0f0c2a1e-0000-4000-8000-000000000901';
const secrets = { clientId: 'gc-client-id-test-0001', clientSecret: 'gc-client-secret-test-0002' };
const config = {
  kind: 'cloud',
  region: 'mypurecloud.de',
  organizationId: '0f0c2a1e-0000-4000-8000-0000000000aa',
  queueIds: [QUEUE],
  userIds: [AGENT_A],
  wrapUpCodes: { SALE },
  dialer: { contactColumns: ['firstName', 'balance'] },
};
const contacts = new URL('./fixtures/contacts.json', import.meta.url);
const fakes = new WeakMap<Connector, FakeGenesys>();
const instant = () => Promise.resolve();
/** One fake platform per connector instance (each harness sees its own conversation history). */
const create = () => {
  const fake = new FakeGenesys(contacts);
  const connector = new GenesysCloudConnector({
    fetch: fake.fetch,
    socket: null,
    sleep: instant,
    random: () => 0.5,
  });
  fakes.set(connector, fake);
  return connector;
};
const fakeOf = (connector: Connector) => {
  const fake = fakes.get(connector);
  if (fake === undefined) throw new Error('no fake');
  return fake;
};
const ingest = async (connector: Connector, payload: unknown) => {
  fakeOf(connector).observe(payload);
  await (connector as GenesysCloudConnector).ingest(payload);
};
const invalid = loadInvalid(new URL('./fixtures/invalid.json', import.meta.url));
const FILES = [
  'voice-inbound.json',
  'dialer-preview.json',
  'message-transfer.json',
  'email.json',
  'callback.json',
  'web-messaging.json',
];

for (const file of FILES) {
  const scenario = loadScenario(new URL(`./fixtures/${file}`, import.meta.url));
  runConnectorContract({
    name: `genesys-cloud / ${scenario.name}`,
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
  name: 'gc',
  create,
  config,
  secrets,
  fixtures: [],
  invalidPayloads: [],
  participant: { platformUserId: 'x', platformInteractionId: 'y' },
  ingest,
};
const voice = loadScenario(new URL('./fixtures/voice-inbound.json', import.meta.url));
const dialer = loadScenario(new URL('./fixtures/dialer-preview.json', import.meta.url));
const C1 = voice.participant.platformInteractionId;

async function upTo(name: string, scenario = voice) {
  const harness = await startHarness(subject);
  for (const fixture of scenario.fixtures) {
    await ingest(harness.connector, fixture.payload);
    if (fixture.name === name) break;
  }
  return {
    harness,
    connector: harness.connector as GenesysCloudConnector,
    fake: fakeOf(harness.connector),
  };
}

describe('genesys cloud connector', () => {
  it('is registered for adapter genesys_cloud / kind cloud', () => {
    expect(
      createConnector('genesys_cloud', { kind: 'cloud' }, { simulatorEnabled: false }),
    ).toBeInstanceOf(GenesysCloudConnector);
    expect(
      createConnector('genesys-cloud', { kind: 'cloud' }, { simulatorEnabled: false }),
    ).toBeInstanceOf(GenesysCloudConnector);
    expect(
      createConnector('genesys_cloud', { kind: 'webhook' }, { simulatorEnabled: false }),
    ).toBeUndefined();
  });

  it('refuses unknown regions and fails init without OAuth client secrets', async () => {
    expect(
      new GenesysCloudConnector().configSchema.safeParse({ ...config, region: 'evil.example' })
        .success,
    ).toBe(false);
    await expect(startHarness({ ...subject, secrets: { clientId: 'only-id' } })).rejects.toThrow();
  });

  it('verifyParticipant asks the Conversations API every time (no cache, Client Credentials)', async () => {
    const { connector, fake } = await upTo('call connected');
    expect(await connector.verifyParticipant(AGENT_A, C1)).toBe(true);
    expect(await connector.verifyParticipant(AGENT_A, C1)).toBe(true);
    const gets = fake.requests('GET', /^\/api\/v2\/conversations\/[^/]+$/);
    expect(gets).toHaveLength(2);
    expect(gets[0]?.authorization).toBe('Bearer fake-token-1');
    expect(fake.tokenRequests).toBe(1);
    const token = fake.calls.find((c) =>
      c.url.startsWith('https://login.mypurecloud.de/oauth/token'),
    );
    expect(token?.body).toBe('grant_type=client_credentials');
  });

  it('verifyParticipant: alerting is refused unless verifyAlerting, unknown/invalid ids are false', async () => {
    const { connector } = await upTo('call alerting');
    expect(await connector.verifyParticipant(AGENT_A, C1)).toBe(false);
    expect(await connector.verifyParticipant(AGENT_A, '../users/me')).toBe(false);
    expect(await connector.verifyParticipant(AGENT_A, '0f0c2a1e-0000-4000-8000-00000000ffff')).toBe(
      false,
    );
    const lenient = await startHarness({ ...subject, config: { ...config, verifyAlerting: true } });
    await ingest(lenient.connector, voice.fixtures[0]?.payload);
    expect(await lenient.connector.verifyParticipant(AGENT_A, C1)).toBe(true);
  });

  it('verifyParticipant propagates platform outages (hub fails closed)', async () => {
    const { connector, fake } = await upTo('call connected');
    for (let i = 0; i < 4; i += 1) fake.failNext(503);
    await expect(connector.verifyParticipant(AGENT_A, C1)).rejects.toBeInstanceOf(ConnectorError);
  });

  it('writes prefixed string participant attributes on the customer participant', async () => {
    const { connector, fake } = await upTo('call connected');
    await connector.writeAttributes(
      { platformInteractionId: C1, commandId: 'cmd-attr-1' },
      { outcome: 'sale', score: 9, vip: true, cleared: null },
    );
    const [patch] = fake.requests('PATCH', /\/attributes$/);
    expect(patch?.url).toContain(
      `/api/v2/conversations/${C1}/participants/0f0c2a1e-0000-4000-8000-000000000011/attributes`,
    );
    expect(patch?.body).toEqual({
      attributes: {
        'Verbis.outcome': 'sale',
        'Verbis.score': '9',
        'Verbis.vip': 'true',
        'Verbis.cleared': '',
      },
    });
  });

  it('sets the wrap-up on the agent communication with mapped code and notes', async () => {
    const { connector, fake } = await upTo('call disconnected, ACW');
    await connector.setWrapUp(
      { platformInteractionId: C1, commandId: 'cmd-wrap-1' },
      { code: 'SALE', subCodes: ['upsell'], note: 'Paket yükseltildi' },
    );
    const [post] = fake.requests('POST', /\/wrapup$/);
    expect(post?.url).toContain(
      `/api/v2/conversations/calls/${C1}/participants/0f0c2a1e-0000-4000-8000-000000000014/communications/0f0c2a1e-0000-4000-8000-000000000013/wrapup`,
    );
    expect(post?.body).toEqual({ code: SALE, notes: '[upsell] Paket yükseltildi' });
    await expect(
      connector.setWrapUp(
        { platformInteractionId: C1, commandId: 'cmd-wrap-2' },
        { code: 'UNKNOWN', subCodes: [] },
      ),
    ).rejects.toMatchObject({
      code: 'genesys_wrapup_unmapped',
    });
  });

  it('secure pause: PATCH recordingState paused/active on voice; no-op on digital', async () => {
    const { connector, fake } = await upTo('call connected');
    await connector.pauseRecording({ platformInteractionId: C1, commandId: 'cmd-pause-1' });
    await connector.resumeRecording({ platformInteractionId: C1, commandId: 'cmd-resume-1' });
    expect(
      fake.requests('PATCH', /^\/api\/v2\/conversations\/calls\/[^/]+$/).map((c) => c.body),
    ).toEqual([{ recordingState: 'paused' }, { recordingState: 'active' }]);
    const chat = loadScenario(new URL('./fixtures/web-messaging.json', import.meta.url));
    const digital = await upTo('web messaging connected', chat);
    await digital.connector.pauseRecording({
      platformInteractionId: chat.participant.platformInteractionId,
      commandId: 'cmd-pause-2',
    });
    expect(digital.fake.requests('PATCH', /^\/api\/v2\/conversations\/calls\//)).toHaveLength(0);
  });

  it('honours 429 Retry-After and retries 5xx for idempotent write-backs', async () => {
    const sleeps: number[] = [];
    const fake = new FakeGenesys(contacts);
    const connector = new GenesysCloudConnector({
      fetch: fake.fetch,
      socket: null,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    });
    const harness = await startHarness({ ...subject, create: () => connector });
    fake.observe(voice.fixtures[1]?.payload);
    fake.failNext(429, { 'retry-after': '3' }, /attributes$/);
    fake.failNext(503, {}, /attributes$/);
    await harness.connector.writeAttributes(
      { platformInteractionId: C1, commandId: 'cmd-rl-1' },
      { outcome: 'x' },
    );
    expect(sleeps[0]).toBe(3_000);
    expect(sleeps).toHaveLength(2);
    expect(fake.requests('PATCH', /attributes$/)).toHaveLength(3);
  });

  it('gives up after repeated 429 with a retryable error (hub retries the command later)', async () => {
    const { connector, fake } = await upTo('call connected');
    for (let i = 0; i < 4; i += 1) fake.failNext(429, { 'retry-after': '1' }, /attributes$/);
    await expect(
      connector.writeAttributes({ platformInteractionId: C1, commandId: 'cmd-rl-2' }, { a: 'b' }),
    ).rejects.toMatchObject({
      code: 'genesys_rate_limited',
      retryable: true,
    });
  });

  it('refreshes the token once on 401', async () => {
    const { connector, fake } = await upTo('call connected');
    fake.failNext(401, {}, /^\/api\/v2\/conversations\/[^/]+$/);
    expect(await connector.verifyParticipant(AGENT_A, C1)).toBe(true);
    expect(fake.tokenRequests).toBe(2);
  });

  it('imports only allow-listed contact-list columns for dialer interactions', async () => {
    const { harness } = await upTo('preview offered', dialer);
    const [offered] = harness.events;
    expect(offered?.attributes).toMatchObject({
      'contact.firstName': 'Ayşe',
      'contact.balance': 1250.5,
    });
    expect(offered?.attributes).not.toHaveProperty('contact.nationalId');
    const none = await startHarness({
      ...subject,
      config: { ...config, dialer: { contactColumns: [] } },
    });
    await ingest(none.connector, dialer.fixtures[0]?.payload);
    expect(
      Object.keys(none.events[0]?.attributes ?? {}).some((k) => k.startsWith('contact.')),
    ).toBe(false);
  });

  it('ignores heartbeat and unrelated topics', async () => {
    const harness = await startHarness(subject);
    const connector = harness.connector as GenesysCloudConnector;
    expect(
      await connector.ingest({
        topicName: 'channel.metadata',
        eventBody: { message: 'WebSocket Heartbeat' },
      }),
    ).toBe(0);
    expect(
      await connector.ingest({ topicName: `v2.users.${AGENT_A}.presence`, eventBody: {} }),
    ).toBe(0);
  });
});

it('retains a failed overflow resync and retries it with backoff', async () => {
  vi.useFakeTimers();
  try {
    const { connector, fake } = await upTo('call connected');
    const frame = voice.fixtures.find((item) => item.name === 'call connected')?.payload;
    const ingestMock = vi.spyOn(connector, 'ingest').mockRejectedValue(new BackpressureError());
    connector.onNotification(frame);
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 501; index++) connector.onNotification(frame);
    ingestMock.mockResolvedValue(1);
    const pattern = new RegExp(`/api/v2/conversations/${C1}$`);
    const before = fake.requests('GET', pattern).length;
    fake.failNext(400, {}, pattern);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.requests('GET', pattern).length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fake.requests('GET', pattern).length).toBe(before + 2);
    await connector.shutdown();
    ingestMock.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});
