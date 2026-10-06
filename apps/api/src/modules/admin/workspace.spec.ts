import { describe, it, expect } from 'vitest';

import { subjectMatches } from './privacy.service.js';
import { AdminConnectorInputSchema, ConnectorConfigSchema } from './workspace.dto.js';
import { parseSamlMetadata } from './workspace.service.js';

describe('administration boundaries', () => {
  const id = '01990000-0000-7000-8000-000000000001';
  it('supports nested connector configuration and bound secret aliases only', () => {
    const input = {
      adapterType: 'generic',
      platform: 'fixture',
      status: 'draft',
      secretRefs: [id],
      config: {
        endpoint: 'https://fixture.example',
        mapping: { queue: 'campaign' },
        secrets: { clientSecret: id },
      },
    };
    expect(AdminConnectorInputSchema.safeParse(input).success).toBe(true);
    expect(AdminConnectorInputSchema.safeParse({ ...input, secretRefs: [] }).success).toBe(false);
  });
  it('rejects plaintext credentials at every configuration depth', () => {
    for (const config of [
      { password: 'fixture' },
      { nested: { apiKey: 'fixture' } },
      { secrets: { clientSecret: 'not-a-reference' } },
      { headers: { Authorization: 'Bearer fixture' } },
      { passwordRef: 'fixture' },
    ])
      expect(ConnectorConfigSchema.safeParse(config).success).toBe(false);
  });
  it('bounds configuration depth', () => {
    let value: unknown = {};
    for (let i = 0; i < 20; i++) value = { nested: value };
    expect(ConnectorConfigSchema.safeParse(value).success).toBe(false);
  });
  it('refuses SAML external entities and malformed metadata', () => {
    for (const xml of [
      '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>',
      '<broken>',
      '<EntityDescriptor/>',
    ])
      expect(() => parseSamlMetadata(xml)).toThrow();
  });
  it('matches exact identifiers only, never unrelated nested values', () => {
    expect(subjectMatches({ attachedData: { customerId: 'fixture' } }, 'fixture')).toBe(true);
    expect(subjectMatches({ ani: 'fixture' }, 'fixture')).toBe(true);
    expect(subjectMatches({ ani: 'fixture-long' }, 'fixture')).toBe(false);
    expect(subjectMatches({ note: 'fixture' }, 'fixture')).toBe(false);
  });
});
