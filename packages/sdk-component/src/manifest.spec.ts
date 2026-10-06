import { describe, expect, it } from 'vitest';

import { type ComponentManifest, validateManifest } from './manifest.js';

const valid: ComponentManifest = {
  type: 'acme.creditGauge',
  version: '1.2.0',
  builtOn: ['box'],
  integrity: 'sha384-abc123+/=',
};

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    expect(validateManifest(valid)).toEqual([]);
  });

  it('reports every problem', () => {
    expect(
      validateManifest({ type: 'gauge', version: '1', builtOn: [], integrity: 'md5-x' }),
    ).toHaveLength(4);
  });
});
