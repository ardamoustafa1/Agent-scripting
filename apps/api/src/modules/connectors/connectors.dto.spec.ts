import { describe, expect, it } from 'vitest';

import { publicConnectorKind, toConnectorDto } from './connectors.dto.js';

import type { ConnectorRow } from './connectors.repository.js';

const row = (config: unknown) =>
  ({
    id: '01928f3a-0000-7000-8000-00000000d401',
    createdAt: new Date('2026-10-08T08:00:00Z'),
    updatedAt: new Date('2026-10-08T08:00:00Z'),
    version: 1,
    adapterType: 'generic',
    platform: 'generic',
    status: 'active',
    health: {},
    config,
  }) as unknown as ConnectorRow;

describe('connector DTO', () => {
  it('exposes only the short kind label of a connector config', () => {
    const dto = toConnectorDto(row({ kind: 'simulator', apiKeyRef: 'secret://tenant/key' }));
    expect(dto.kind).toBe('simulator');
    expect(JSON.stringify(dto)).not.toContain('secret://');
    expect('config' in dto).toBe(false);
  });
  it('omits kind when the config has none, is malformed or looks like free text', () => {
    for (const config of [
      null,
      undefined,
      {},
      { kind: 42 },
      { kind: 'Has Spaces' },
      { kind: 'x'.repeat(80) },
    ])
      expect('kind' in toConnectorDto(row(config)), JSON.stringify(config)).toBe(false);
    expect(publicConnectorKind('plain string')).toBeUndefined();
  });
});
