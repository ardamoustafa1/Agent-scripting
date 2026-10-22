import { describe, expect, it } from 'vitest';

import { signWebhook } from '@verbis/sdk-connector';
import {
  runConnectorContract,
  startHarness,
  type ContractSubject,
} from '@verbis/sdk-connector/testing';

import { loadInvalid, loadScenario } from '../../test/scenario.js';

import { GenericWebhookConnector, WebhookSignatureError } from './generic-webhook.connector.js';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const secrets = {
  signingSecret: 'whsec-test-signing-0001',
  callbackSecret: 'whsec-test-callback-0002',
};
const config = { kind: 'webhook', callbackUrl: 'https://crm.example.test/verbis/callback' };
const callbacks: { url: string; body: string; signature: string | null }[] = [];
const fakeFetch = ((url: string, init: RequestInit) => {
  callbacks.push({
    url,
    body:
      typeof init.body === 'string'
        ? init.body
        : (() => {
            throw new Error('Expected JSON request body');
          })(),
    signature: new Headers(init.headers).get('x-verbis-signature'),
  });
  return Promise.resolve(new Response(null, { status: 204 }));
}) as unknown as typeof fetch;
const create = () => new GenericWebhookConnector({ fetch: fakeFetch });
const sign = (payload: unknown) => {
  const body = JSON.stringify(payload);
  return {
    body,
    signature: signWebhook(secrets.signingSecret, body, Math.floor(NOW.getTime() / 1000)),
  };
};
const invalid = loadInvalid(new URL('./fixtures/invalid.json', import.meta.url));
const lifecycle = (id: string, type: string, second: number) => ({
  id,
  type,
  occurred_at: `2026-10-01T10:05:0${String(second)}.000Z`,
  interaction: { id: 'call-2001', channel: 'voice', agent: { id: 'agent-009' } },
});
const segment = (id: string, second: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'transcript.segment',
  occurred_at: `2026-10-01T10:05:0${String(second)}.000Z`,
  interaction_id: 'call-2001',
  speaker: 'customer',
  text: 'Faturamda bir hata var.',
  ...extra,
});
const transcriptFixtures: ContractSubject['transcriptFixtures'] = [
  { name: 'offered', payload: lifecycle('call-2001-e1', 'interaction.offered', 0), expected: [] },
  {
    name: 'speech before connect is ignored',
    payload: segment('seg-0', 1),
    expected: [],
  },
  {
    name: 'connected',
    payload: lifecycle('call-2001-e2', 'interaction.connected', 2),
    expected: [],
  },
  {
    name: 'final customer line',
    payload: segment('seg-1', 3, { language: 'tr' }),
    expected: [
      {
        segmentId: 'seg-1',
        platformInteractionId: 'call-2001',
        speaker: 'customer',
        text: 'Faturamda bir hata var.',
        final: true,
        language: 'tr',
      },
    ],
  },
  {
    name: 'interim agent line',
    payload: segment('seg-2', 4, { speaker: 'agent', text: 'Hemen bakıyorum', final: false }),
    expected: [{ segmentId: 'seg-2', speaker: 'agent', final: false }],
  },
];

for (const file of ['voice-call.json', 'chat-transfer.json', 'email.json']) {
  const scenario = loadScenario(new URL(`./fixtures/${file}`, import.meta.url));
  runConnectorContract({
    name: `generic-webhook / ${scenario.name}`,
    create,
    config,
    secrets,
    fixtures: scenario.fixtures,
    invalidPayloads: invalid,
    participant: scenario.participant,
    transcriptFixtures,
    ingest: async (connector, payload) => {
      const { body, signature } = sign(payload);
      await (connector as GenericWebhookConnector).handleWebhook(body, signature);
    },
  });
}

describe('generic webhook transport', () => {
  const subject = {
    name: 'gw',
    create,
    config,
    secrets,
    fixtures: [],
    invalidPayloads: [],
    participant: { platformUserId: 'x', platformInteractionId: 'y' },
    ingest: () => Promise.resolve(),
  };
  const voice = loadScenario(new URL('./fixtures/voice-call.json', import.meta.url));
  const first = voice.fixtures[0]?.payload;

  it('refuses unsigned, tampered, stale and wrong-secret requests before parsing', async () => {
    const harness = await startHarness(subject, () => NOW);
    const connector = harness.connector as GenericWebhookConnector;
    const { body, signature } = sign(first);
    await expect(connector.handleWebhook(body, undefined)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(connector.handleWebhook(`${body} `, signature)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    const stale = signWebhook(
      secrets.signingSecret,
      body,
      Math.floor(NOW.getTime() / 1000) - 3_600,
    );
    await expect(connector.handleWebhook(body, stale)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    const foreign = signWebhook('someone-elses-secret', body, Math.floor(NOW.getTime() / 1000));
    await expect(connector.handleWebhook(body, foreign)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(
      connector.handleWebhook(
        'not json',
        signWebhook(secrets.signingSecret, 'not json', Math.floor(NOW.getTime() / 1000)),
      ),
    ).rejects.toThrow();
    expect(harness.events).toEqual([]);
  });

  it('accepts the previous secret during rotation', async () => {
    const harness = await startHarness(
      {
        ...subject,
        secrets: {
          ...secrets,
          signingSecret: 'new-secret-xyz',
          previousSigningSecret: secrets.signingSecret,
        },
      },
      () => NOW,
    );
    const { body, signature } = sign(first);
    expect(
      await (harness.connector as GenericWebhookConnector).handleWebhook(body, signature),
    ).toBe(1);
  });

  it('signs write-back callbacks and sends each commandId once', async () => {
    callbacks.length = 0;
    const harness = await startHarness(subject, () => NOW);
    const target = { platformInteractionId: 'call-1001', commandId: 'cmd-abc-123' };
    await harness.connector.writeAttributes(target, { outcome: 'sale' });
    await harness.connector.writeAttributes(target, { outcome: 'sale' });
    await harness.connector.setWrapUp(
      { ...target, commandId: 'cmd-abc-124' },
      { code: 'SALE', subCodes: [] },
    );
    expect(callbacks).toHaveLength(2);
    expect(callbacks[0]?.url).toBe(config.callbackUrl);
    expect(callbacks[0]?.signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(JSON.parse(callbacks[1]?.body ?? '{}')).toMatchObject({
      command: 'setWrapUp',
      wrapUp: { code: 'SALE' },
    });
  });

  it('refuses http callback URLs and fails init without a signing secret', async () => {
    expect(
      create().configSchema.safeParse({
        kind: 'webhook',
        callbackUrl: 'http://crm.example.test/cb',
      }).success,
    ).toBe(false);
    await expect(startHarness({ ...subject, secrets: {} })).rejects.toThrow();
  });

  it('drops out-of-order transitions (ended before connected is final)', async () => {
    const harness = await startHarness(subject, () => NOW);
    const connector = harness.connector as GenericWebhookConnector;
    const ended = voice.fixtures.at(-1)?.payload;
    const connected = voice.fixtures[1]?.payload;
    for (const payload of [first, ended, connected]) {
      const { body, signature } = sign(payload);
      await connector.handleWebhook(body, signature);
    }
    expect(harness.events.map((e) => e.type)).toEqual(['interactionOffered', 'ended']);
  });
});

describe('generic webhook transcript segments', () => {
  const subject = {
    name: 'gw-transcript',
    create,
    config,
    secrets,
    fixtures: [],
    invalidPayloads: [],
    participant: { platformUserId: 'x', platformInteractionId: 'y' },
    ingest: () => Promise.resolve(),
  };

  it('rejects malformed or blank segments and needs a valid signature', async () => {
    const harness = await startHarness(subject, () => NOW);
    const connector = harness.connector as GenericWebhookConnector;
    for (const payload of [
      segment('seg-x', 1, { text: '   ' }),
      segment('seg-x', 1, { speaker: 'bot' }),
      segment('seg-x', 1, { audio: 'AAAA' }),
      { ...segment('seg-x', 1), interaction_id: undefined },
    ])
      await expect(connector.ingest(payload)).rejects.toThrow(/payload rejected/i);
    const { body } = sign(segment('seg-x', 1));
    await expect(connector.handleWebhook(body, 'v1,t=0,bad')).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    expect(harness.transcripts).toEqual([]);
  });

  it('stops forwarding speech once the interaction ended', async () => {
    const harness = await startHarness(subject, () => NOW);
    const connector = harness.connector as GenericWebhookConnector;
    await connector.ingest(lifecycle('call-2001-e1', 'interaction.offered', 0));
    await connector.ingest(lifecycle('call-2001-e2', 'interaction.connected', 1));
    expect(await connector.ingest(segment('seg-1', 2))).toBe(1);
    await connector.ingest(lifecycle('call-2001-e3', 'interaction.ended', 3));
    expect(await connector.ingest(segment('seg-2', 4))).toBe(0);
    expect(harness.transcripts.map((t) => t.segmentId)).toEqual(['seg-1']);
  });
});
