import { describe, expect, it } from 'vitest';

import { RuntimePorts } from './runtime-ports.js';

describe('secure provider boundary', () => {
  const input = {
    tenantId: 'tenant',
    sessionId: 'session',
    variable: 'card',
    receipt: 'tok_abcdefghijklmnop',
  };
  it('fails closed without a provider and never treats arbitrary input as a token', async () => {
    const ports = new RuntimePorts();
    await expect(ports.verify(input)).rejects.toThrow('not configured');
    ports.registerTokenVerifier({
      verify: () => Promise.resolve({ token: 'synthetic-clear-value' }),
    });
    await expect(ports.verify(input)).rejects.toThrow('Invalid token');
  });
  it('accepts only a server-verified opaque provider token', async () => {
    const ports = new RuntimePorts();
    ports.registerTokenVerifier({ verify: () => Promise.resolve({ token: input.receipt }) });
    await expect(ports.verify(input)).resolves.toEqual({ token: input.receipt });
    expect(() => ports.connector('unknown')).toThrow('not configured');
  });
});
