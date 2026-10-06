import { describe, it, expect } from 'vitest';

import { ScriptVersionSchema, CreateVersionSchema } from './scripts.dto.js';

describe('designer linked screen metadata', () => {
  it('requires complete link metadata so drafts cannot silently detach on save', () => {
    const schema = ScriptVersionSchema.pick({ screens: true });
    expect(schema.safeParse({}).success).toBe(false);
    const screens = [
      {
        sharedScreenId: '01928f3a-0000-7000-8000-000000000009',
        versionNumber: 2,
        mode: 'linked',
        pageIds: ['shared-home'],
      },
    ];
    expect(schema.parse({ screens }).screens).toEqual(screens);
    expect(schema.safeParse({ screens: [{ ...screens[0], mode: 'other' }] }).success).toBe(false);
  });
  it('accepts a pinned linked screen on subsequent draft writes', () => {
    const screens = [
      { sharedScreenId: '01928f3a-0000-7000-8000-000000000009', versionNumber: 2, mode: 'linked' },
    ];
    expect(CreateVersionSchema.shape.screens.parse(screens)).toEqual(screens);
  });
});
