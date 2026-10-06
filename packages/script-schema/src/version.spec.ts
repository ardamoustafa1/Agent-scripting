import { describe, expect, it } from 'vitest';

import { isSupportedSchemaVersion, SCRIPT_SCHEMA_VERSION } from './version.js';

describe('isSupportedSchemaVersion', () => {
  it('supports the current version', () => {
    expect(isSupportedSchemaVersion(SCRIPT_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedSchemaVersion('1.4.2')).toBe(true);
  });

  it('supports N-1 major', () => {
    expect(isSupportedSchemaVersion('0.9.0')).toBe(true);
  });

  it('rejects future majors and malformed versions', () => {
    expect(isSupportedSchemaVersion('2.0.0')).toBe(false);
    expect(isSupportedSchemaVersion('1.0')).toBe(false);
    expect(isSupportedSchemaVersion('01.0.0')).toBe(false);
  });
});
