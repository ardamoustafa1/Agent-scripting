import { describe, expect, it, vi } from 'vitest';

import { LaunchDeniedError } from './domain/launch.js';
import { LaunchPorts } from './launch-ports.js';

const input = { tenantId: 't', connectorId: 'c', externalId: 'x', ctiIdentities: [] };

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof LaunchDeniedError ? error.reason : 'other';
  }
}

describe('LaunchPorts', () => {
  it('fails closed without a verifier', async () => {
    expect(await reason(new LaunchPorts().verify(input))).toBe('connector_unavailable');
  });

  it('passes only an explicit true', async () => {
    const ports = new LaunchPorts();
    ports.registerVerifier('c', { isActiveParticipant: () => Promise.resolve(true) });
    expect(await reason(ports.verify(input))).toBe('ok');
    ports.registerVerifier('c', { isActiveParticipant: () => Promise.resolve(false) });
    expect(await reason(ports.verify(input))).toBe('platform_unverified');
    ports.registerVerifier('c', { isActiveParticipant: () => Promise.reject(new Error('down')) });
    expect(await reason(ports.verify(input))).toBe('platform_unverified');
  });

  it('treats a hanging platform as unverified', async () => {
    vi.useFakeTimers();
    const ports = new LaunchPorts();
    ports.registerVerifier('c', {
      isActiveParticipant: () => new Promise<boolean>(() => undefined),
    });
    const pending = reason(ports.verify(input));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe('platform_unverified');
    vi.useRealTimers();
  });
});
