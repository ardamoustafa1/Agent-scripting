import { describe, expect, it } from 'vitest';

import { ConnectorError } from '@verbis/sdk-connector';
import {
  runConnectorContract,
  startHarness,
  type ContractSubject,
} from '@verbis/sdk-connector/testing';

import { loadInvalid, loadScenario } from '../../test/scenario.js';

import { SimulatorConnector } from './simulator.connector.js';

const scenario = loadScenario(new URL('./fixtures/chat-lifecycle.json', import.meta.url));
const subject: ContractSubject & { create: () => SimulatorConnector } = {
  name: `simulator / ${scenario.name}`,
  create: () => new SimulatorConnector(),
  config: { kind: 'simulator' },
  fixtures: scenario.fixtures,
  invalidPayloads: loadInvalid(new URL('./fixtures/invalid.json', import.meta.url)),
  participant: scenario.participant,
  transcriptFixtures: [
    {
      name: 'create a call for speech',
      payload: {
        op: 'create',
        requestId: 'speech-create',
        at: '2026-10-22T10:00:00.000Z',
        platformInteractionId: 'sim-speech-1',
        input: { channel: 'voice', agentPlatformUserId: 'agent-7', autoConnect: false },
      },
      expected: [],
    },
    {
      name: 'speech before the call is connected is ignored',
      payload: {
        op: 'action',
        requestId: 'speech-early',
        at: '2026-10-22T10:00:01.000Z',
        platformInteractionId: 'sim-speech-1',
        input: { action: 'utterance', message: 'Alo?' },
      },
      expected: [],
    },
    {
      name: 'connect',
      payload: {
        op: 'action',
        requestId: 'speech-connect',
        at: '2026-10-22T10:00:02.000Z',
        platformInteractionId: 'sim-speech-1',
        input: { action: 'connect' },
      },
      expected: [],
    },
    {
      name: 'customer line',
      payload: {
        op: 'action',
        requestId: 'speech-1',
        at: '2026-10-22T10:00:03.000Z',
        platformInteractionId: 'sim-speech-1',
        input: { action: 'utterance', message: ' Aboneliğimi iptal etmek istiyorum. ' },
      },
      expected: [
        {
          segmentId: 'sim-speech-1',
          platformInteractionId: 'sim-speech-1',
          speaker: 'customer',
          text: 'Aboneliğimi iptal etmek istiyorum.',
          final: true,
        },
      ],
    },
    {
      name: 'agent line',
      payload: {
        op: 'action',
        requestId: 'speech-2',
        at: '2026-10-22T10:00:04.000Z',
        platformInteractionId: 'sim-speech-1',
        input: { action: 'utterance', speaker: 'agent', message: 'Size yardımcı olayım.' },
      },
      expected: [{ speaker: 'agent', text: 'Size yardımcı olayım.' }],
    },
  ],
  ingest: async (connector: unknown, payload: unknown) => {
    await (connector as SimulatorConnector).ingest(payload);
  },
};

runConnectorContract(subject);

describe('simulator control API', () => {
  it('routes queued interactions through the configured campaign external mapping', async () => {
    const harness = await startHarness(subject);
    const sim = harness.connector as SimulatorConnector;
    const call = await sim.create({
      agentPlatformUserId: 'qa-agent',
      channel: 'voice',
      queue: 'qa-queue',
      autoConnect: true,
    });
    await sim.act(call.platformInteractionId, { action: 'hold' });
    expect(harness.events.map((event) => event.campaignRef)).toEqual([
      { kind: 'queue', externalId: 'qa-queue' },
      { kind: 'queue', externalId: 'qa-queue' },
      { kind: 'queue', externalId: 'qa-queue' },
    ]);
    await sim.create({ agentPlatformUserId: 'another-agent', channel: 'voice' });
    expect(harness.events.at(-1)?.campaignRef).toBeUndefined();
    await sim.create({ agentPlatformUserId: 'empty-queue-agent', channel: 'voice', queue: '' });
    expect(harness.events.at(-1)?.campaignRef).toBeUndefined();
  });
  it('gives each concurrent digital interaction its own lifecycle (3 chats + 1 email)', async () => {
    const harness = await startHarness(subject);
    const sim = harness.connector as SimulatorConnector;
    const agent = { agentPlatformUserId: 'sim-agent-9' };
    const chats = await Promise.all(
      [1, 2, 3].map((n) =>
        sim.create({ ...agent, channel: 'chat', message: `chat ${String(n)}`, autoConnect: true }),
      ),
    );
    const email = await sim.create({
      ...agent,
      channel: 'email',
      subject: 'İade',
      message: 'Ürün bozuk',
    });
    expect(new Set([...chats, email].map((i) => i.platformInteractionId)).size).toBe(4);
    await expect(sim.create({ ...agent, channel: 'chat' })).rejects.toBeInstanceOf(ConnectorError);
    expect(harness.events.filter((e) => e.type === 'connected')).toHaveLength(3);
    expect(harness.events.find((e) => e.channel === 'email')?.context).toMatchObject({
      channel: 'email',
      subject: 'İade',
      body: 'Ürün bozuk',
    });
    // Ending one chat frees a slot.
    await sim.act(chats[0]?.platformInteractionId ?? '', { action: 'end' });
    await expect(sim.create({ ...agent, channel: 'chat' })).resolves.toMatchObject({
      status: 'alerting',
    });
  });

  it('builds rich channel context and appends customer messages', async () => {
    const harness = await startHarness(subject);
    const sim = harness.connector as SimulatorConnector;
    const chat = await sim.create({
      agentPlatformUserId: 'a',
      channel: 'chat',
      customerName: 'Can',
      message: 'Merhaba',
      autoConnect: true,
    });
    const updated = await sim.act(chat.platformInteractionId, {
      action: 'customerMessage',
      message: 'Fatura?',
    });
    expect(updated.context).toMatchObject({
      channel: 'chat',
      transcript: [{ text: 'Merhaba' }, { text: 'Fatura?' }],
    });
    for (const channel of ['voice', 'sms', 'whatsapp', 'social', 'video', 'callback'] as const)
      expect(
        (await sim.create({ agentPlatformUserId: `agent-${channel}`, channel })).context.channel,
      ).toBe(channel);
  });

  it('transfers to another agent and records commands for the UI', async () => {
    const harness = await startHarness(subject);
    const sim = harness.connector as SimulatorConnector;
    const call = await sim.create({
      agentPlatformUserId: 'a1',
      channel: 'voice',
      autoConnect: true,
    });
    await sim.act(call.platformInteractionId, {
      action: 'transfer',
      transferToPlatformUserId: 'a2',
    });
    expect(await sim.verifyParticipant('a2', call.platformInteractionId)).toBe(true);
    expect(await sim.verifyParticipant('a1', call.platformInteractionId)).toBe(false);
    await expect(
      sim.act(call.platformInteractionId, { action: 'transfer' }),
    ).rejects.toBeInstanceOf(ConnectorError);
    await sim.pauseRecording({
      platformInteractionId: call.platformInteractionId,
      commandId: 'c-1',
    });
    await sim.setWrapUp(
      { platformInteractionId: call.platformInteractionId, commandId: 'c-2' },
      { code: 'RESOLVED', subCodes: [] },
    );
    await sim.setWrapUp(
      { platformInteractionId: call.platformInteractionId, commandId: 'c-2' },
      { code: 'RESOLVED', subCodes: [] },
    );
    expect(sim.snapshot().commands.map((c) => c.command)).toEqual(['pauseRecording', 'setWrapUp']);
    await sim.act(call.platformInteractionId, { action: 'end' });
    await expect(sim.act(call.platformInteractionId, { action: 'hold' })).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });
});
