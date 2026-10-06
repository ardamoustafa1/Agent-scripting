import { describe, expect, it, vi } from 'vitest';

import { RuntimePorts } from '../runtime/runtime-ports.js';

import { HubRuntimeBridge } from './hub-runtime-bridge.js';

import type { HubClient } from './hub-client.js';

const outcome = {
  tenantId: 'tenant-a',
  interactionId: 'call-a',
  commandId: 'event-1234',
  code: 'success',
  subCodes: [],
  note: 'Synthetic note',
  fields: { score: 5 },
};
function fixture(configured = true) {
  const call = vi.fn().mockResolvedValue(null);
  const ports = new RuntimePorts();
  const bridge = new HubRuntimeBridge({ configured, call } as unknown as HubClient, ports);
  bridge.onModuleInit();
  return { call, ports };
}
describe('runtime connector hub bridge', () => {
  it('connects outcome jobs to actual hub commands with stable retry identities', async () => {
    const f = fixture();
    await f.ports.connector('connector-a').writeOutcome(outcome);
    expect(f.call.mock.calls.map((args: unknown[]) => args.slice(0, 3))).toEqual([
      ['tenant-a', 'POST', '/internal/v1/connectors/connector-a/commands/writeAttributes'],
      ['tenant-a', 'POST', '/internal/v1/connectors/connector-a/commands/setWrapUp'],
    ]);
    expect(f.call.mock.calls[0]?.[4]).toMatchObject({
      commandId: 'event-1234:attributes',
      attributes: { score: 5 },
    });
    expect(f.call.mock.calls[1]?.[4]).toMatchObject({
      commandId: 'event-1234:wrapup',
      wrapUp: { code: 'success', note: 'Synthetic note' },
    });
  });
  it('propagates failed writes so no success acknowledgement can be emitted', async () => {
    const f = fixture();
    f.call.mockRejectedValueOnce(new Error('unavailable'));
    await expect(f.ports.connector('connector-a').writeOutcome(outcome)).rejects.toThrow(
      'unavailable',
    );
    expect(f.call).toHaveBeenCalledOnce();
  });
  it('validates the full outcome before sending any partial command', async () => {
    const f = fixture();
    await expect(
      f.ports.connector('connector-a').writeOutcome({ ...outcome, code: '' }),
    ).rejects.toThrow();
    await expect(
      f.ports.connector('connector-a').writeOutcome({ ...outcome, fields: { 'invalid key': 1 } }),
    ).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
  });
  it('serializes structured fields and forwards callback timestamps', async () => {
    const f = fixture();
    await f.ports.connector('connector-a').writeOutcome({
      ...outcome,
      fields: { selection: ['a', 'b'], details: { count: 2 }, empty: null },
      callbackAt: '2026-10-05T10:00:00Z',
    });
    expect(f.call.mock.calls[0]?.[4]).toMatchObject({
      attributes: {
        selection: '["a","b"]',
        details: '{"count":2}',
        empty: null,
        callbackAt: '2026-10-05T10:00:00Z',
      },
    });
  });
  it('retries a partial failure using the same command identities', async () => {
    const f = fixture();
    f.call.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('wrapup unavailable'));
    await expect(f.ports.connector('connector-a').writeOutcome(outcome)).rejects.toThrow(
      'wrapup unavailable',
    );
    await f.ports.connector('connector-a').writeOutcome(outcome);
    expect(
      f.call.mock.calls.map((args: unknown[]) => (args[4] as { commandId: string }).commandId),
    ).toEqual([
      'event-1234:attributes',
      'event-1234:wrapup',
      'event-1234:attributes',
      'event-1234:wrapup',
    ]);
  });
  it('does not issue empty attribute writes', async () => {
    const f = fixture();
    await f.ports.connector('connector-a').writeOutcome({
      tenantId: outcome.tenantId,
      interactionId: outcome.interactionId,
      commandId: outcome.commandId,
      code: outcome.code,
      subCodes: outcome.subCodes,
      fields: {},
    });
    expect(f.call).toHaveBeenCalledOnce();
    expect(f.call.mock.calls[0]?.[2]).toContain('/commands/setWrapUp');
  });
  it('fails closed when the hub is unconfigured', () => {
    expect(() => fixture(false).ports.connector('connector-a')).toThrow('not configured');
  });
  it('sends pause/resume commands and preserves explicitly registered connectors', async () => {
    const f = fixture();
    for (const paused of [true, false])
      await f.ports.connector('connector-a').pauseRecording({
        tenantId: 'tenant-a',
        interactionId: 'call-a',
        commandId: 'record-1234',
        paused,
      });
    expect(f.call.mock.calls.map((args: unknown[]) => args[2])).toEqual([
      '/internal/v1/connectors/connector-a/commands/pauseRecording',
      '/internal/v1/connectors/connector-a/commands/resumeRecording',
    ]);
    const specific = { writeOutcome: vi.fn(), pauseRecording: vi.fn() };
    f.ports.registerConnector('custom', specific);
    expect(f.ports.connector('custom')).toBe(specific);
  });
});
