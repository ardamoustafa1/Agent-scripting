import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BackpressureError } from '@verbis/sdk-connector';

import { engageSubjects, SidecarConfigSchema } from '../genesys-engage/config.js';
import { EngageCommandSchema } from '../genesys-engage/envelope.js';

import { NatsSidecarTransport } from './nats-sidecar-transport.js';

const CONNECTOR = '0190f000-0000-7000-8000-00000000e001';
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Hub ↔ sidecar link against a real NATS JetStream (Testcontainers). */
describe('NATS sidecar transport (integration)', () => {
  let container: StartedTestContainer;
  let server: string;

  beforeAll(async () => {
    container = await new GenericContainer('nats:2.11-alpine')
      .withCommand(['-js'])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
      .start();
    server = `nats://${container.getHost()}:${String(container.getMappedPort(4222))}`;
    const nc = await connect({ servers: server });
    await (
      await jetstreamManager(nc)
    ).streams.add({
      name: 'VERBIS_ENGAGE',
      subjects: ['verbis.connector.engage.*.event.v1'],
      duplicate_window: 120_000_000_000,
    });
    await nc.close();
  }, 120_000);

  afterAll(async () => {
    await container.stop();
  });

  it('consumes envelopes durably, redelivers on backpressure, answers commands and verify', async () => {
    const subjects = engageSubjects(CONNECTOR);
    const producer = await connect({ servers: server });
    const js = jetstream(producer);
    // Sidecar stand-in: reply to commands and verify.
    producer.subscribe(subjects.commands, {
      callback: (_e, m) => {
        m.respond(enc.encode(JSON.stringify({ ok: true })));
      },
    });
    producer.subscribe(subjects.verify, {
      callback: (_e, m) => {
        const req = JSON.parse(dec.decode(m.data)) as { platformUserId: string };
        m.respond(enc.encode(JSON.stringify({ participant: req.platformUserId === 'E1001' })));
      },
    });
    const config = SidecarConfigSchema.parse({ kind: 'sidecar', nats: { servers: [server] } });
    const transport = new NatsSidecarTransport({
      connectorId: CONNECTOR,
      subjects,
      nats: config.nats,
      logger,
    });
    const received: unknown[] = [];
    let refuse = 1;
    await transport.start((payload) => {
      if (refuse > 0) {
        refuse -= 1;
        return Promise.reject(new BackpressureError('full'));
      }
      received.push(payload);
      return Promise.resolve();
    });
    const envelope = { schema: 'verbis.engage.envelope.v1', eventId: 'TServer:1' };
    await js.publish(subjects.events, enc.encode(JSON.stringify(envelope)), { msgID: 'TServer:1' });
    await js.publish(subjects.events, enc.encode(JSON.stringify(envelope)), { msgID: 'TServer:1' }); // producer retry: deduped
    await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1);
    await transport.send(
      EngageCommandSchema.parse({
        type: 'updateUserData',
        commandId: 'c1',
        interactionId: '006d02a8b1c3f001',
        mediaType: 'voice',
        userData: { A: '1' },
      }),
    );
    expect(await transport.verify('E1001', '006d02a8b1c3f001')).toBe(true);
    expect(await transport.verify('E2002', '006d02a8b1c3f001')).toBe(false);
    await transport.stop();
    await producer.close();
  }, 60_000);
});
