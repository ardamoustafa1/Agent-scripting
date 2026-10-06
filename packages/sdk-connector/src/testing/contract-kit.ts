import { describe, expect, it, onTestFinished } from 'vitest';

import { isAdapterType } from '../adapter.js';
import { COMMAND_FEATURE, supportsFeature, validateCapabilities } from '../capabilities.js';
import {
  BackpressureError,
  COMMAND_NAMES,
  type Connector,
  type ConnectorContext,
  type ConnectorLogger,
} from '../connector.js';
import { CommandNotSupportedError, PayloadRejectedError } from '../errors.js';
import { InteractionEventSchema, type InteractionEvent } from '../interaction.js';

/** A recorded platform payload and the normalized events it must produce. */
export interface ConnectorFixture {
  readonly name: string;
  readonly payload: unknown;
  /** Partial match per emitted event, in order. Empty ⇒ the payload is ignored. */
  readonly expected: readonly Partial<InteractionEvent>[];
}

export interface ContractSubject {
  readonly name: string;
  create(): Connector;
  readonly config: unknown;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly fixtures: readonly ConnectorFixture[];
  /** Payloads the mapper must refuse (schema violations, wrong types, oversize). */
  readonly invalidPayloads: readonly unknown[];
  /** Vendor-native attributes used to exercise write-back capabilities. */
  readonly commandAttributes?: Readonly<Record<string, string>>;
  /** Feeds a raw platform payload into the connector as its transport would (webhook, socket…). */
  ingest(connector: Connector, payload: unknown): Promise<void>;
  /** After all fixtures were ingested: a pair that must verify, from the fixtures. */
  readonly participant: { readonly platformUserId: string; readonly platformInteractionId: string };
}

export interface TestHarness {
  readonly connector: Connector;
  readonly events: InteractionEvent[];
  readonly logs: { level: string; message: string; fields?: Record<string, unknown> }[];
  setBackpressure(on: boolean): void;
}

export async function startHarness(
  subject: ContractSubject,
  now = () => new Date('2026-10-01T10:00:00.000Z'),
): Promise<TestHarness> {
  const connector = subject.create();
  // Bind cleanup to the current test, including concurrent contract runs and assertion failures.
  onTestFinished(() => connector.shutdown());
  const events: InteractionEvent[] = [];
  const logs: TestHarness['logs'] = [];
  let backpressure = false;
  const log =
    (level: string): ConnectorLogger[keyof ConnectorLogger] =>
    (message, fields) => {
      logs.push({ level, message, ...(fields === undefined ? {} : { fields }) });
    };
  const ctx: ConnectorContext = {
    connectorId: '0190f000-0000-7000-8000-00000000c0de',
    tenantId: '0190f000-0000-7000-8000-00000000beef',
    config: subject.config,
    secrets: {
      get: (name) => {
        const value = subject.secrets?.[name];
        return value === undefined
          ? Promise.reject(new Error(`secret ${name} missing`))
          : Promise.resolve(value);
      },
    },
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    now,
    emit: (event) => {
      if (backpressure) return Promise.reject(new BackpressureError('queue full'));
      events.push(InteractionEventSchema.parse(event));
      return Promise.resolve();
    },
  };
  await connector.init(ctx);
  return {
    connector,
    events,
    logs,
    setBackpressure: (on) => {
      backpressure = on;
    },
  };
}

async function ingestAll(subject: ContractSubject, harness: TestHarness): Promise<void> {
  for (const fixture of subject.fixtures) await subject.ingest(harness.connector, fixture.payload);
}

/**
 * The shared contract every connector must pass (ADR-0008). Call it from the connector's spec:
 * `runConnectorContract(subject)`. Platform access is never needed: fixtures are recorded payloads.
 */
export function runConnectorContract(subject: ContractSubject): void {
  describe(`connector contract: ${subject.name}`, () => {
    it('declares a known type, valid capabilities and accepts its config', () => {
      const connector = subject.create();
      expect(isAdapterType(connector.type)).toBe(true);
      expect(connector.kind).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
      expect(validateCapabilities(connector.capabilities)).toEqual([]);
      expect(connector.configSchema.safeParse(subject.config).success).toBe(true);
    });

    it('runs the lifecycle: init → health → shutdown', async () => {
      const harness = await startHarness(subject);
      const health = await harness.connector.health();
      expect(['up', 'degraded']).toContain(health.status);
      expect(Number.isNaN(Date.parse(health.checkedAt))).toBe(false);
      await harness.connector.shutdown();
      expect((await harness.connector.health()).status).toBe('down');
      await expect(harness.connector.shutdown()).resolves.toBeUndefined();
    });

    for (const fixture of subject.fixtures)
      it(`maps fixture "${fixture.name}" to normalized events`, async () => {
        const harness = await startHarness(subject);
        // Earlier fixtures establish state (offered before connected…).
        for (const earlier of subject.fixtures) {
          if (earlier === fixture) break;
          await subject.ingest(harness.connector, earlier.payload);
        }
        const before = harness.events.length;
        await subject.ingest(harness.connector, fixture.payload);
        const emitted = harness.events.slice(before);
        expect(emitted).toHaveLength(fixture.expected.length);
        fixture.expected.forEach((expected, index) => {
          expect(emitted[index]).toMatchObject(expected);
        });
        for (const event of emitted)
          expect(InteractionEventSchema.safeParse(event).success).toBe(true);
      });

    it('rejects invalid payloads without emitting', async () => {
      const harness = await startHarness(subject);
      for (const payload of subject.invalidPayloads) {
        await expect(subject.ingest(harness.connector, payload)).rejects.toBeInstanceOf(
          PayloadRejectedError,
        );
      }
      expect(harness.events).toEqual([]);
    });

    it('is idempotent: re-delivering the same platform event emits nothing new', async () => {
      const harness = await startHarness(subject);
      await ingestAll(subject, harness);
      const count = harness.events.length;
      await ingestAll(subject, harness);
      expect(harness.events).toHaveLength(count);
    });

    it('propagates backpressure instead of dropping events', async () => {
      const harness = await startHarness(subject);
      harness.setBackpressure(true);
      const first = subject.fixtures.find((f) => f.expected.length > 0);
      expect(first).toBeDefined();
      await expect(subject.ingest(harness.connector, first?.payload)).rejects.toBeInstanceOf(
        BackpressureError,
      );
      harness.setBackpressure(false);
      // The same event is accepted on retry (not marked as seen while refused).
      await subject.ingest(harness.connector, first?.payload);
      expect(harness.events.length).toBeGreaterThan(0);
    });

    it('honours declared features for every command and deduplicates commandId', async () => {
      const harness = await startHarness(subject);
      await ingestAll(subject, harness);
      const target = {
        platformInteractionId: subject.participant.platformInteractionId,
        commandId: 'cmd-1',
      };
      for (const name of COMMAND_NAMES) {
        const run = () => {
          switch (name) {
            case 'writeAttributes':
              return harness.connector.writeAttributes(
                target,
                subject.commandAttributes ?? { verbisOutcome: 'sale' },
              );
            case 'setWrapUp':
              return harness.connector.setWrapUp(target, { code: 'SALE', subCodes: [] });
            case 'pauseRecording':
              return harness.connector.pauseRecording(target);
            case 'resumeRecording':
              return harness.connector.resumeRecording(target);
          }
        };
        if (supportsFeature(harness.connector.capabilities, COMMAND_FEATURE[name])) {
          await expect(run()).resolves.toBeUndefined();
          await expect(run()).resolves.toBeUndefined();
        } else {
          await expect(run()).rejects.toBeInstanceOf(CommandNotSupportedError);
        }
      }
    });

    it('verifies only current participants', async () => {
      const harness = await startHarness(subject);
      await ingestAll(subject, harness);
      const { platformUserId, platformInteractionId } = subject.participant;
      // Fixtures end the interaction last; replay up to (not including) the end for the live check.
      const live = await startHarness(subject);
      for (const fixture of subject.fixtures) {
        if (fixture.expected.some((e) => e.type === 'ended')) break;
        await subject.ingest(live.connector, fixture.payload);
      }
      expect(await live.connector.verifyParticipant(platformUserId, platformInteractionId)).toBe(
        true,
      );
      expect(await live.connector.verifyParticipant('someone-else', platformInteractionId)).toBe(
        false,
      );
      expect(await live.connector.verifyParticipant(platformUserId, 'no-such-interaction')).toBe(
        false,
      );
      if (harness.events.some((e) => e.type === 'ended'))
        expect(
          await harness.connector.verifyParticipant(platformUserId, platformInteractionId),
        ).toBe(false);
    });

    it('never leaks secrets into events or logs', async () => {
      const harness = await startHarness(subject);
      await ingestAll(subject, harness);
      const dump = JSON.stringify({ events: harness.events, logs: harness.logs });
      for (const value of Object.values(subject.secrets ?? {})) expect(dump).not.toContain(value);
    });
  });
}
