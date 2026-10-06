import { z } from 'zod';

import {
  type Attributes,
  type CommandTarget,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type WrapUp,
} from '../connector.js';
import { CommandNotSupportedError } from '../errors.js';
import { defineMapper, mapPlatformEvent } from '../mapper.js';

import { runConnectorContract } from './contract-kit.js';

/** Minimal reference connector: proves the kit itself (and documents the expected behaviour). */
const mapper = defineMapper({
  name: 'reference',
  payloadSchema: z.strictObject({
    id: z.string().min(1),
    conv: z.string().min(1),
    agent: z.string(),
    state: z.enum(['ring', 'talk', 'bye']),
  }),
  map: (p) => ({
    eventId: p.id,
    type: p.state === 'ring' ? 'interactionOffered' : p.state === 'talk' ? 'connected' : 'ended',
    occurredAt: '2026-10-01T10:00:00.000Z',
    platformInteractionId: p.conv,
    channel: 'voice',
    direction: 'inbound',
    agent: { id: p.agent },
  }),
});

class ReferenceConnector implements Connector {
  readonly type = 'generic' as const;
  readonly kind = 'reference';
  readonly capabilities = { channels: ['voice'] as const, features: ['writeBack'] as const };
  readonly configSchema = z.strictObject({});
  #ctx: ConnectorContext | undefined;
  #seen = new Set<string>();
  #live = new Map<string, string>();
  async init(ctx: ConnectorContext) {
    this.#ctx = ctx;
    await ctx.secrets.get('token');
  }
  health(): Promise<ConnectorHealth> {
    return Promise.resolve({
      status: this.#ctx === undefined ? 'down' : 'up',
      checkedAt: new Date().toISOString(),
    });
  }
  shutdown() {
    this.#ctx = undefined;
    return Promise.resolve();
  }
  async ingest(raw: unknown) {
    for (const event of mapPlatformEvent(mapper, raw)) {
      if (this.#seen.has(event.eventId)) continue;
      await this.#ctx?.emit(event);
      this.#seen.add(event.eventId);
      if (event.type === 'ended') this.#live.delete(event.platformInteractionId);
      else if (event.agent !== undefined)
        this.#live.set(event.platformInteractionId, event.agent.id);
    }
  }
  writeAttributes(_t: CommandTarget, _a: Attributes) {
    return Promise.resolve();
  }
  setWrapUp(_t: CommandTarget, _w: WrapUp): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('setWrapUp'));
  }
  pauseRecording(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('pauseRecording'));
  }
  resumeRecording(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('resumeRecording'));
  }
  verifyParticipant(user: string, conv: string) {
    return Promise.resolve(this.#live.get(conv) === user);
  }
}

runConnectorContract({
  name: 'reference',
  create: () => new ReferenceConnector(),
  config: {},
  secrets: { token: 'super-secret-token-value' },
  fixtures: [
    {
      name: 'ring',
      payload: { id: 'e1', conv: 'c1', agent: 'a1', state: 'ring' },
      expected: [{ type: 'interactionOffered', platformInteractionId: 'c1' }],
    },
    {
      name: 'talk',
      payload: { id: 'e2', conv: 'c1', agent: 'a1', state: 'talk' },
      expected: [{ type: 'connected' }],
    },
    {
      name: 'bye',
      payload: { id: 'e3', conv: 'c1', agent: 'a1', state: 'bye' },
      expected: [{ type: 'ended' }],
    },
  ],
  invalidPayloads: [{}, { id: 'e9', conv: 'c', agent: 'a', state: 'explode' }, 'text'],
  ingest: (connector, payload) => (connector as ReferenceConnector).ingest(payload),
  participant: { platformUserId: 'a1', platformInteractionId: 'c1' },
});
